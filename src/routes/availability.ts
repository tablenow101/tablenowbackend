import { Router, Request, Response } from 'express';
import supabase from '../config/supabase';

const router = Router();

// ──────────────────────────────────────────────
// GET /api/availability
// Créneaux disponibles pour une date + nb couverts
// Query: restaurant_id, date (YYYY-MM-DD), covers
// ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
    const { restaurant_id, date, covers = '2' } = req.query as Record<string, string>;

    if (!restaurant_id || !date) {
        return res.status(400).json({ error: 'restaurant_id et date sont requis' });
    }

    // 1. Vérifie si fermé ce jour
    const { data: closed } = await supabase
        .from('closed_dates')
        .select('reason')
        .eq('restaurant_id', restaurant_id)
        .eq('closed_on', date)
        .maybeSingle();

    if (closed) {
        return res.json({
            available: false,
            reason: 'closed',
            message: closed.reason || 'Le restaurant est fermé ce jour-là.',
            slots: []
        });
    }

    // 2. Appelle la RPC
    const { data: slots, error } = await supabase.rpc('get_available_slots', {
        p_restaurant_id: restaurant_id,
        p_date: date,
        p_covers: parseInt(covers, 10)
    });

    if (error) {
        console.error('[availability] get_available_slots error:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }

    const availableSlots = (slots as any[]).filter(s => s.available);

    return res.json({
        available: availableSlots.length > 0,
        date,
        covers: parseInt(covers, 10),
        slots: slots,
        available_slots: availableSlots,
        // Script prêt pour l'agent vocal
        agent_script: availableSlots.length > 0
            ? `J'ai de la disponibilité le ${date} aux créneaux suivants : ${availableSlots.map(s => s.slot_time.slice(0, 5)).join(', ')}. Quel horaire vous convient ?`
            : `Je suis désolé, nous n'avons plus de disponibilité pour ${covers} personne${parseInt(covers) > 1 ? 's' : ''} le ${date}. Souhaitez-vous que je vous propose une autre date ?`
    });
});

// ──────────────────────────────────────────────
// GET /api/availability/next
// Prochain créneau disponible dans les 14 jours
// Query: restaurant_id, covers
// ──────────────────────────────────────────────
router.get('/next', async (req: Request, res: Response) => {
    const { restaurant_id, covers = '2' } = req.query as Record<string, string>;

    if (!restaurant_id) {
        return res.status(400).json({ error: 'restaurant_id requis' });
    }

    const coversInt = parseInt(covers, 10);

    for (let i = 1; i <= 14; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        // Check closed
        const { data: closed } = await supabase
            .from('closed_dates')
            .select('id')
            .eq('restaurant_id', restaurant_id)
            .eq('closed_on', dateStr)
            .maybeSingle();

        if (closed) continue;

        const { data: slots } = await supabase.rpc('get_available_slots', {
            p_restaurant_id: restaurant_id,
            p_date: dateStr,
            p_covers: coversInt
        });

        const availableSlots = (slots as any[] || []).filter(s => s.available);
        if (availableSlots.length > 0) {
            return res.json({
                date: dateStr,
                available_slots: availableSlots,
                agent_script: `La prochaine disponibilité pour ${coversInt} personne${coversInt > 1 ? 's' : ''} est le ${dateStr} à ${availableSlots[0].slot_time.slice(0, 5)}. Cela vous conviendrait-il ?`
            });
        }
    }

    return res.json({
        date: null,
        available_slots: [],
        agent_script: `Je n'ai pas de disponibilité dans les 14 prochains jours pour ${coversInt} personne${coversInt > 1 ? 's' : ''}. Souhaitez-vous laisser vos coordonnées ?`
    });
});

// ──────────────────────────────────────────────
// POST /api/bookings
// Crée une réservation directe (web/dashboard)
// Body: restaurant_id, phone, name, email?,
//       booked_for (ISO), covers, special_requests?
// ──────────────────────────────────────────────
router.post('/bookings', async (req: Request, res: Response) => {
    const { restaurant_id, phone, name, email, booked_for, covers, special_requests, source = 'web' } = req.body;

    const missing = ['restaurant_id', 'phone', 'booked_for', 'covers'].filter(k => !req.body[k]);
    if (missing.length) {
        return res.status(400).json({ error: 'Champs requis manquants', missing });
    }

    try {
        // Find or create customer
        let { data: customer } = await supabase
            .from('customers')
            .select('id')
            .eq('restaurant_id', restaurant_id)
            .eq('phone', phone)
            .single();

        if (!customer) {
            const { data: created, error: cErr } = await supabase
                .from('customers')
                .insert({ restaurant_id, phone, name: name || null, email: email || null })
                .select('id')
                .single();
            if (cErr) throw cErr;
            customer = created;
        }

        // Vérifier disponibilité au créneau demandé
        const bookedDate = new Date(booked_for).toISOString().split('T')[0];
        const { data: slots } = await supabase.rpc('get_available_slots', {
            p_restaurant_id: restaurant_id,
            p_date: bookedDate,
            p_covers: parseInt(covers, 10)
        });

        const slotHHMM = new Date(booked_for).toTimeString().slice(0, 5);
        const targetSlot = (slots as any[] || []).find(s => s.slot_time.slice(0, 5) === slotHHMM);

        if (targetSlot && !targetSlot.available) {
            return res.status(409).json({ error: 'Créneau complet', remaining: targetSlot.remaining });
        }

        // Créer la réservation
        const { data: booking, error: bErr } = await supabase
            .from('bookings')
            .insert({
                restaurant_id,
                customer_id: customer!.id,
                booked_for,
                covers: parseInt(covers, 10),
                special_requests: special_requests || null,
                source,
                status: 'confirmed'
            })
            .select()
            .single();

        if (bErr) throw bErr;

        return res.json({ success: true, booking });
    } catch (err: any) {
        console.error('[POST /bookings]', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
