// ============================================
// POST /create-reservation
// Appelé après confirmation verbale de l'agent
// ============================================

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { Request, Response } from 'express';
import { getServiceType } from './checkAvailability';

// ============================================
// Verrou par restaurant (in-memory, VPS unique)
// ============================================
const restaurantLocks = new Map<string, Promise<void>>();

async function withRestaurantLock<T>(restaurantId: string, fn: () => Promise<T>): Promise<T> {
    const previous = restaurantLocks.get(restaurantId) || Promise.resolve();

    let releaseLock!: () => void;
    const current = previous.then(() => new Promise<void>((resolve) => {
        releaseLock = resolve;
    }));

    restaurantLocks.set(restaurantId, current);

    const timeout = setTimeout(() => {
        console.warn(`[lock] Timeout forcé pour restaurant ${restaurantId}`);
        releaseLock();
    }, 8000);

    try {
        await previous;
        return await fn();
    } finally {
        clearTimeout(timeout);
        releaseLock();
        if (restaurantLocks.get(restaurantId) === current) {
            restaurantLocks.delete(restaurantId);
        }
    }
}

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Transporter Resend SMTP (même config que email.service.ts)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: {
        user: process.env.SMTP_USER || 'resend',
        pass: process.env.SMTP_PASS
    }
});

// ============================================
// Google Calendar
// ============================================
async function createCalendarEvent(restaurantData: any, reservation: any): Promise<string | null> {
    // Parse des tokens depuis google_calendar_tokens (JSON stocké en base)
    if (!restaurantData.google_calendar_tokens) return null;

    let tokens: any;
    try {
        tokens = typeof restaurantData.google_calendar_tokens === 'string'
            ? JSON.parse(restaurantData.google_calendar_tokens)
            : restaurantData.google_calendar_tokens;
    } catch {
        return null;
    }

    if (!tokens?.access_token) return null;

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startDate = new Date(`${reservation.date}T${reservation.time}:00`);
    const endDate = new Date(startDate.getTime() + 90 * 60 * 1000);
    const endTime = endDate.toTimeString().slice(0, 5);

    const event = {
        summary: `[TableNow] ${reservation.first_name} ${reservation.last_name} — ${reservation.covers} pers.`,
        description: [
            `📞 ${reservation.phone}`,
            reservation.email ? `📧 ${reservation.email}` : '',
            reservation.occasion ? `🎉 Occasion : ${reservation.occasion}` : '',
            `\nRéservation prise automatiquement via TableNow`
        ].filter(Boolean).join('\n'),
        start: {
            dateTime: `${reservation.date}T${reservation.time}:00`,
            timeZone: 'Europe/Paris'
        },
        end: {
            dateTime: `${reservation.date}T${endTime}:00`,
            timeZone: 'Europe/Paris'
        },
        colorId: reservation.service_type === 'midi' ? '5' : '9'
    };

    const response = await calendar.events.insert({
        calendarId: tokens.calendar_id || 'primary',
        requestBody: event
    });

    return (response as any).data?.id || null;
}

// ============================================
// Email confirmation client (via Resend SMTP)
// ============================================
async function sendConfirmationEmail(restaurantData: any, reservation: any): Promise<boolean> {
    if (!reservation.email) return false;

    const dateFormatted = new Date(reservation.date).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    await transporter.sendMail({
        from: `${restaurantData.name} <${process.env.EMAIL_FROM || `info@${process.env.EMAIL_DOMAIN}`}>`,
        to: reservation.email,
        subject: `Confirmation de votre réservation — ${restaurantData.name}`,
        html: `
        <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
            <h2 style="font-size: 22px; margin-bottom: 8px;">Réservation confirmée</h2>
            <p style="color: #555; margin-bottom: 24px;">${restaurantData.name} vous attend.</p>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #888; width: 140px;">Date</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold;">${dateFormatted}</td></tr>
                <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #888;">Heure</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold;">${reservation.time}</td></tr>
                <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #888;">Couverts</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold;">${reservation.covers} personne${reservation.covers > 1 ? 's' : ''}</td></tr>
                <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #888;">Nom</td><td style="padding: 10px 0; border-bottom: 1px solid #eee;">${reservation.first_name} ${reservation.last_name}</td></tr>
                ${reservation.occasion ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #888;">Occasion</td><td style="padding: 10px 0; border-bottom: 1px solid #eee;">${reservation.occasion}</td></tr>` : ''}
            </table>
            <p style="margin-top: 24px; color: #555; font-size: 14px;">Pour modifier ou annuler, appelez le <strong>${restaurantData.phone}</strong>.</p>
            <p style="margin-top: 32px; font-size: 12px; color: #aaa;">${restaurantData.name} · ${restaurantData.address || ''}</p>
        </div>`
    });
    return true;
}

// ============================================
// BCC vers le PMS du restaurant
// ============================================
async function sendBccToPMS(restaurantData: any, reservation: any): Promise<boolean> {
    if (!restaurantData.pms_email) return false;

    const dateFormatted = new Date(reservation.date).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    await transporter.sendMail({
        from: `TableNow — ${restaurantData.name} <${process.env.EMAIL_FROM || `info@${process.env.EMAIL_DOMAIN}`}>`,
        to: restaurantData.pms_email,
        subject: `Nouvelle réservation — ${reservation.first_name} ${reservation.last_name} — ${reservation.date} ${reservation.time}`,
        html: `
        <p><strong>Nouvelle réservation via TableNow</strong></p>
        <ul>
            <li><strong>Nom :</strong> ${reservation.first_name} ${reservation.last_name}</li>
            <li><strong>Téléphone :</strong> ${reservation.phone}</li>
            <li><strong>Email :</strong> ${reservation.email || 'non renseigné'}</li>
            <li><strong>Date :</strong> ${dateFormatted}</li>
            <li><strong>Heure :</strong> ${reservation.time}</li>
            <li><strong>Couverts :</strong> ${reservation.covers}</li>
            ${reservation.occasion ? `<li><strong>Occasion :</strong> ${reservation.occasion}</li>` : ''}
        </ul>`
    });
    return true;
}

// ============================================
// Handler principal
// ============================================
export async function createReservation(req: Request, res: Response): Promise<void> {
    const {
        restaurant_id, service_id, first_name, last_name,
        phone, email, covers, occasion, date, time
    } = req.body;

    const required: Record<string, any> = { restaurant_id, service_id, first_name, last_name, phone, covers, date, time };
    const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);

    if (missing.length > 0) {
        res.status(400).json({ success: false, reason: 'missing_params', missing });
        return;
    }

    const coversInt = parseInt(covers, 10);
    const serviceType = getServiceType(time);

    const result = await withRestaurantLock(restaurant_id, async () => {
        try {
            const { data: service, error: serviceError } = await supabase
                .from('services')
                .select('id, remaining_covers, is_closed')
                .eq('id', service_id)
                .single();

            if (serviceError || !service) {
                return res.status(404).json({ success: false, reason: 'service_not_found' });
            }

            if (service.is_closed || service.remaining_covers < coversInt) {
                return res.status(409).json({
                    success: false,
                    reason: 'no_longer_available',
                    agent_script: `Je suis vraiment désolé, il semblerait que ce créneau vienne juste d'être complet. Souhaitez-vous que je vous propose une autre date ?`
                });
            }

            const { data: restaurant } = await supabase
                .from('restaurants')
                .select('name, phone, address, pms_email, google_calendar_tokens')
                .eq('id', restaurant_id)
                .single();

            // ── Find or create customer — keyed by (restaurant_id, phone) ──
            let customerId: string | null = null;
            {
                const { data: existing } = await supabase
                    .from('customers')
                    .select('id')
                    .eq('restaurant_id', restaurant_id)
                    .eq('phone', phone)
                    .single();
                if (existing) {
                    customerId = existing.id;
                } else {
                    const { data: created } = await supabase
                        .from('customers')
                        .insert({
                            restaurant_id,
                            phone,
                            name: `${first_name} ${last_name}`.trim(),
                            email: email || null
                        })
                        .select('id')
                        .single();
                    customerId = created?.id || null;
                }
            }

            // Internal object used by calendar/email helpers
            const reservationInfo = {
                restaurant_id, service_id,
                first_name, last_name, phone,
                email: email || null,
                covers: coversInt,
                occasion: occasion || null,
                date, time
            };

            // Booking insert — new schema
            const bookedFor = `${date}T${time}:00`;
            const { data: newBooking, error: insertError } = await supabase
                .from('bookings')
                .insert({
                    restaurant_id,
                    customer_id: customerId,
                    booked_for: bookedFor,
                    covers: coversInt,
                    special_requests: occasion || null,
                    source: 'phone',
                    status: 'confirmed'
                })
                .select()
                .single();

            if (insertError) throw insertError;

            console.log(`✅ Booking: ${newBooking.id} — customer: ${customerId}`);

            // Étapes non-bloquantes après libération du verrou
            let calendarEventId: string | null = null;
            try {
                calendarEventId = await createCalendarEvent(restaurant, reservationInfo);
                if (calendarEventId) {
                    await supabase.from('bookings').update({ google_calendar_event_id: calendarEventId }).eq('id', newBooking.id);
                }
            } catch (calendarErr: any) {
                console.error('[create-reservation] Calendar error (non-bloquant):', calendarErr.message);
            }

            let emailSent = false;
            try {
                emailSent = await sendConfirmationEmail(restaurant, reservationInfo);
                await supabase.from('bookings').update({ confirmation_email_sent: emailSent }).eq('id', newBooking.id);
            } catch (emailErr: any) {
                console.error('[create-reservation] Email error (non-bloquant):', emailErr.message);
            }

            let bccSent = false;
            try {
                bccSent = await sendBccToPMS(restaurant, reservationInfo);
                await supabase.from('bookings').update({ bcc_email_sent: bccSent }).eq('id', newBooking.id);
            } catch (bccErr: any) {
                console.error('[create-reservation] BCC error (non-bloquant):', bccErr.message);
            }

            return res.json({
                success: true,
                reservation_id: newBooking.id,
                calendar_event_id: calendarEventId,
                confirmation_email_sent: emailSent,
                bcc_sent: bccSent,
                agent_script: `Parfait ${first_name}, votre réservation est confirmée pour ${coversInt} personne${coversInt > 1 ? 's' : ''} le ${date} à ${time}. ${email ? `Vous allez recevoir un email de confirmation. ` : ''}Nous avons hâte de vous accueillir. À bientôt !`
            });

        } catch (err: any) {
            console.error('[create-reservation] Erreur critique:', err);
            return res.status(500).json({
                success: false,
                reason: 'internal_error',
                agent_script: `Je suis désolé, je rencontre une difficulté technique. Votre réservation n'a pas pu être enregistrée. Je vous invite à rappeler directement le restaurant.`
            });
        }
    });
}
