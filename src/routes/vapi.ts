import { Router, Request, Response } from 'express';
import supabase from '../config/supabase';
import emailService from '../services/email.service';
import hubspotService from '../services/hubspot.service';
import ragService from '../services/rag.service';
import twilioService from '../services/twilio.service';
import vapiService from '../services/vapi.service';

// Load Calendar Service dynamically to avoid circular deps if any
const calendarService = require('../services/calendar.service').default;

const router = Router();

/**
 * VAPI webhook handler for call events
 */
router.post('/webhook', async (req: Request, res: Response) => {
    try {
        const event = req.body.message || req.body; // VAPI wraps events in 'message'
        console.log('VAPI Webhook received:', JSON.stringify(event, null, 2));

        // Handle different event types
        switch (event.type) {
            case 'call.started':
                await handleCallStarted(event);
                break;
            case 'call.ended':
                await handleCallEnded(event);
                break;
            case 'tool-calls':
                return await handleToolCalls(event, res);
            case 'function-call':
                return await handleFunctionCall(event, res);
            case 'assistant-request':
                return await handleAssistantRequest(event, res);
            case 'end-of-call-report':
                console.log('Processing end-of-call-report event:', JSON.stringify(event, null, 2));
                await handleCallEnded(event); // Reuse the same handler as call.ended
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }

        res.json({ received: true });
    } catch (error: any) {
        console.error('VAPI webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * Handle call started event
 */
async function handleCallStarted(event: any) {
    const { call, phoneNumber } = event;
    const phoneId = phoneNumber?.id || call?.phoneNumber?.id;
    const phoneNum = phoneNumber?.number || call?.phoneNumber?.number;

    // Find restaurant by phone ID, then fall back to phone number
    let { data: restaurant } = await supabase
        .from('restaurants')
        .select('*')
        .eq('vapi_phone_id', phoneId || '')
        .single();

    if (!restaurant && phoneNum) {
        const fallbackLookup = await supabase
            .from('restaurants')
            .select('*')
            .eq('vapi_phone_number', phoneNum)
            .single();
        restaurant = fallbackLookup.data || null;
    }

    if (!restaurant) {
        console.error('Restaurant not found for phone:', { phoneId, phoneNum });
        return;
    }

    // Create call log
    await supabase.from('call_logs').insert({
        restaurant_id: restaurant.id,
        call_id: call.id,
        caller_number: call.customer?.number,
        status: 'in_progress',
        started_at: new Date().toISOString()
    });
}

/**
 * Handle call ended event
 */
async function handleCallEnded(event: any) {
    const { call, transcript, recording } = event;
    const callId = call?.id;
    
    // Extract phone information based on VAPI webhook structure
    let phoneId, phoneNum;
    
    if (event.type === 'end-of-call-report') {
        // For end-of-call-report, phone info is in the root event object
        phoneId = event.phoneNumber?.id || event.phone?.id;
        phoneNum = event.phoneNumber?.number || event.phone?.number;
        
        // If phoneNum is an object, extract the number from it
        if (phoneNum && typeof phoneNum === 'object') {
            phoneNum = phoneNum.number || phoneNum.id;
        }
    } else {
        // For call.ended, use the call object
        phoneId = call?.phoneNumber?.id || call?.phone?.id;
        phoneNum = call?.phoneNumber?.number || call?.phone?.number;
    }
    
    // Robust extraction for duration, transcript, and recording
    let duration = event.durationSeconds || event.duration || call?.duration || call?.durationSeconds || 0;
    let finalTranscript = event.transcript || transcript || call?.transcript || '';
    let finalRecordingUrl = event.recordingUrl || recording?.url || call?.recordingUrl || '';
    let startedAt = event.startedAt || call?.startedAt;
    let endedAt = event.endedAt || call?.endedAt;

    // Fallback duration calculation if 0 but we have timestamps
    if (!duration && startedAt && endedAt) {
        const start = new Date(startedAt).getTime();
        const end = new Date(endedAt).getTime();
        if (end > start) {
            duration = Math.floor((end - start) / 1000);
        }
    }

    console.log('Processing call end event:', {
        type: event.type,
        callId,
        phoneId,
        phoneNum,
        extractedDuration: duration,
        hasTranscript: !!finalTranscript,
        hasRecording: !!finalRecordingUrl,
        eventKeys: Object.keys(event)
    });

    try {
        // Try to update existing call log
        const { data: updated, error: updateError } = await supabase
            .from('call_logs')
            .update({
                status: 'completed',
                duration: duration,
                transcript: finalTranscript,
                recording_url: finalRecordingUrl,
                ended_at: endedAt || new Date().toISOString()
            })
            .eq('call_id', callId)
            .select('id, restaurant_id');

        const hasUpdated = Array.isArray(updated) && updated.length > 0;

        // If no existing log, create one now
        if (!hasUpdated) {
            let { data: restaurant } = await supabase
                .from('restaurants')
                .select('*')
                .eq('vapi_phone_id', phoneId || '')
                .single();

            if (!restaurant && phoneNum) {
                const fallbackLookup = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('vapi_phone_number', phoneNum)
                    .single();
                restaurant = fallbackLookup.data || null;
            }

            if (restaurant) {
                const finalStartedAt = startedAt
                    ? new Date(startedAt).toISOString()
                    : new Date(Date.now() - (duration || 0) * 1000).toISOString();

                await supabase.from('call_logs').insert({
                    restaurant_id: restaurant.id,
                    call_id: callId,
                    caller_number: call?.customer?.number,
                    status: 'completed',
                    duration: duration,
                    transcript: finalTranscript,
                    recording_url: finalRecordingUrl,
                    started_at: finalStartedAt,
                    ended_at: endedAt || new Date().toISOString()
                });
            } else {
                console.error('Restaurant not found for call.ended fallback:', { phoneId, phoneNum });
            }
        } else if (updateError) {
            console.error('Call log update error:', updateError);
        }

        // Log activity in HubSpot
        if (call?.customer?.email) {
            try {
                await hubspotService.logActivity({
                    contactEmail: call.customer.email,
                    activityType: 'call',
                    subject: 'AI Phone Call',
                    body: `Call duration: ${duration || 0}s\n\nTranscript:\n${finalTranscript || 'No transcript available'}`
                });
            } catch (error) {
                console.error('HubSpot logging error:', error);
            }
        }
    } catch (error) {
        console.error('Call ended handling error:', error);
    }
}

/**
 * Handle function calls from VAPI assistant
 */
async function handleFunctionCall(event: any, res: Response) {
    const { functionName, parameters, call } = event;

    console.log(`Function call: ${functionName}`, parameters);

    // Find restaurant
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('*')
        .eq('vapi_assistant_id', call.assistantId)
        .single();

    if (!restaurant) {
        return res.json({ error: 'Restaurant not found' });
    }

    return res.json(await executeFunctionCall(functionName, restaurant, parameters));
}

/**
 * Handle assistant-request to inject dynamic overrides (Date/Time)
 */
async function handleAssistantRequest(event: any, res: Response) {
    const call = event.call;
    const phoneId = call?.phoneNumberId || event.phoneNumber?.id;
    const phoneNum = call?.phoneNumber || event.phoneNumber?.number;

    let { data: restaurant } = await supabase
        .from('restaurants')
        .select('*')
        .eq('vapi_phone_id', phoneId || '')
        .single();

    if (!restaurant && phoneNum) {
        const fallback = await supabase
            .from('restaurants')
            .select('*')
            .eq('vapi_phone_number', phoneNum)
            .single();
        restaurant = fallback.data || null;
    }

    if (!restaurant) {
        return res.json({ error: 'Restaurant not found' });
    }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

    console.log(`Injecting dynamic prompt for ${restaurant.name} context:`, { currentDate, currentTime, dayOfWeek });

    // Fetch the baseline system prompt from the service
    const basePrompt = vapiService.generateEnhancedSystemPrompt(restaurant);

    // Create the dynamic time-injection string
    const dynamicTimeContext = `\n\nCRITICAL LIVE DATA DO NOT IGNORE:\n- Today's Date is: ${currentDate} (${dayOfWeek})\n- The Current Time is: ${currentTime}\n\nWARNING: Always use this date/time to resolve relative terms like 'tomorrow', 'next week', 'tonight', or 'this evening'. NEVER invent or guess a different year. The year is strictly ${now.getFullYear()}.\n\n`;

    // Inject system message override into the assistant model
    return res.json({
        assistant: {
            model: {
                messages: [
                    {
                        role: "system",
                        content: basePrompt + dynamicTimeContext
                    }
                ]
            }
        }
    });
}

/**
 * Handle tool-calls batch from VAPI (new event type)
 */
async function handleToolCalls(event: any, res: Response) {
    try {
        const { call, toolCalls = [] } = event;
        if (!toolCalls.length) {
            return res.json({ toolResults: [] });
        }

        console.log('Received tool-calls:', JSON.stringify({ call, toolCalls }, null, 2));

        // Determine assistant/phone ids from event
        const assistantId =
            call?.assistantId ||
            event.assistantId ||
            event.assistant?.id ||
            event.assistant?.assistantId;
        const phoneId = event.phoneNumber?.id || call?.phoneNumber?.id;

        // Find restaurant by assistant id, fallback to phone id
        let { data: restaurant } = await supabase
            .from('restaurants')
            .select('*')
            .eq('vapi_assistant_id', assistantId || '')
            .single();

        if (!restaurant && phoneId) {
            const lookup = await supabase
                .from('restaurants')
                .select('*')
                .eq('vapi_phone_id', phoneId)
                .single();
            restaurant = lookup.data || null;
        }

        if (!restaurant) {
            return res.json({
                toolResults: toolCalls.map((tc: any) => ({
                    toolCallId: tc.id,
                    result: { error: 'Restaurant not found' }
                }))
            });
        }

        const toolResults: any[] = [];
        for (const tc of toolCalls) {
            const functionName = tc.function?.name || tc.name;
            let params: any = {};
            try {
                const rawArgs = tc.function?.arguments || tc.parameters || tc.function?.input || '{}';
                params = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
            } catch (parseErr) {
                toolResults.push({
                    toolCallId: tc.id,
                    result: { error: 'Invalid parameters' }
                });
                continue;
            }

            const result = await executeFunctionCall(functionName, restaurant, params);
            toolResults.push({
                toolCallId: tc.id,
                result
            });
        }

        // Send both modern and legacy-friendly shapes
        const payload = {
            toolResults,
            results: toolResults.map(tr => ({ toolCallId: tr.toolCallId, result: tr.result })),
            result: toolResults[0]?.result,
            tool_results: toolResults // legacy snake_case fallback
        };

        return res.json(payload);
    } catch (error: any) {
        console.error('VAPI tool-calls error:', error);
        return res.status(500).json({ error: 'Tool handling failed' });
    }
}

/**
 * Shared executor for function calls
 */
async function executeFunctionCall(functionName: string, restaurant: any, parameters: any) {
    switch (functionName) {
        case 'check_availability':
            return await checkAvailability(restaurant.id, restaurant, parameters);
        case 'create_booking':
            return await createBooking(restaurant.id, restaurant, parameters);
        case 'update_booking':
            return await updateBooking(restaurant.id, restaurant, parameters);
        case 'cancel_booking':
            return await cancelBooking(restaurant.id, restaurant, parameters);
        case 'answer_question':
            return await answerQuestion(restaurant.id, restaurant, parameters);
        default:
            return { error: 'Unknown function' };
    }
}

/**
 * Check availability function
 */
async function checkAvailability(restaurantId: string, restaurant: any, params: any) {
    const { date, time, partySize } = params;
    console.log(`🔍 Checking availability for Restaurant ${restaurantId}:`, { date, time, partySize });

    try {
        let isAvailable = false;
        let suggestionMessage = '';
        let googleChecked = false;

        // 1. Check Google Calendar (Priority)
        if (restaurant.google_calendar_tokens) {
            console.log('📅 Using Google Calendar for availability check...');
            try {
                const tokens = JSON.parse(restaurant.google_calendar_tokens);
                const startTime = new Date(`${date}T${time}:00`);
                const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // Assume 1 hour default

                // Check specific slot
                isAvailable = await calendarService.checkAvailability(tokens, startTime, endTime);
                googleChecked = true;

                if (!isAvailable) {
                    console.log('❌ Slot busy in Google Calendar. Finding alternatives...');
                    const suggestions = await calendarService.findAvailableSlots(tokens, new Date(date));

                    if (suggestions.length > 0) {
                        const topSuggestions = suggestions.slice(0, 3).join(', ');
                        suggestionMessage = `Sorry, that time is taken. However, we have availability at: ${topSuggestions}.`;
                    } else {
                        suggestionMessage = `Sorry, we are fully booked on ${date}.`;
                    }
                }
            } catch (err) {
                console.error('⚠️ Google Calendar check failed, falling back to local DB:', err);
                // Fallback to local DB check logic below
            }
        }

        // 2. Fallback: Local Database Check (if GCal failed or not connected)
        if (!googleChecked) {
            const { data: bookings } = await supabase
                .from('bookings')
                .select('party_size')
                .eq('restaurant_id', restaurantId)
                .eq('booking_date', date)
                .eq('booking_time', time)
                .eq('status', 'confirmed');

            const totalBooked = bookings?.reduce((sum, b) => sum + b.party_size, 0) || 0;
            isAvailable = (restaurant.capacity || 50) - totalBooked >= partySize;
        }

        // 3. Construct Result
        const result = {
            result: isAvailable ? 'available' : 'unavailable',
            message: isAvailable
                ? `Yes, we have availability for ${partySize} guests on ${date} at ${time}.`
                : (suggestionMessage || `Sorry, we don't have availability for ${partySize} guests at that time.`)
        };

        console.log('✅ Availability check result:', result);
        return result;

    } catch (error) {
        console.error('❌ Availability check failed:', error);
        return {
            result: 'error',
            message: 'I am sorry, I cannot check availability right now due to a technical issue.'
        };
    }
}

/**
 * Create booking function
 */
async function createBooking(restaurantId: string, restaurant: any, params: any) {
    const { guestName, guestEmail, guestPhone, date, time, partySize, specialRequests } = params;

    const normalizedTime = normalizeTime(time);

    const confirmationNumber = `TN-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // 1. Create Booking in Database
    const { data: booking, error } = await supabase
        .from('bookings')
        .insert({
            restaurant_id: restaurantId,
            guest_name: guestName,
            guest_email: guestEmail,
            guest_phone: guestPhone,
            booking_date: date,
            booking_time: normalizedTime,
            party_size: partySize,
            special_requests: specialRequests,
            confirmation_number: confirmationNumber,
            status: 'confirmed',
            source: 'phone'
        })
        .select()
        .single();

    if (error) {
        return { success: false, message: 'Failed to create booking. Please try again.' };
    }

    // 2. Create Event in Google Calendar (Real-time Sync)
    if (restaurant.google_calendar_tokens) {
        try {
            console.log('📅 Creating Google Calendar event...');
            const tokens = JSON.parse(restaurant.google_calendar_tokens);
            const startTime = new Date(`${date}T${normalizedTime}:00`);
            const endTime = new Date(startTime.getTime() + 90 * 60000); // 90 mins duration

            const gCalEvent = await calendarService.createEvent(tokens, {
                summary: `Reservation: ${guestName} (${partySize} ppl)`,
                description: `Phone: ${guestPhone}\nEmail: ${guestEmail}\nSpecial Requests: ${specialRequests || 'None'}\nConfirmation: ${confirmationNumber}`,
                start: startTime,
                end: endTime,
                attendees: guestEmail ? [guestEmail] : []
            });

            // Update booking with Google Event ID
            await supabase
                .from('bookings')
                .update({ calendar_event_id: gCalEvent.id })
                .eq('id', booking.id);

            console.log('✅ Google Calendar event created:', gCalEvent.id);
        } catch (calendarError) {
            console.error('⚠️ Google Calendar error:', calendarError);
        }
    }

    // 3. Send Emails & Notifications (Previous Logic)
    if (guestEmail) {
        try {
            await emailService.sendBookingConfirmation({
                to: guestEmail,
                restaurantName: restaurant.name || 'Restaurant',
                guestName,
                date,
                time,
                partySize,
                confirmationNumber
            });
        } catch (emailErr) {
            console.error('⚠️ Failed to send booking confirmation email:', emailErr);
        }
    }

    if (restaurant.email) {
        try {
            await emailService.sendRestaurantNotification({
                to: restaurant.email,
                subject: 'New Phone Booking',
                message: `${guestName} booked a table for ${partySize} on ${date} at ${time}. Special requests: ${specialRequests || 'None'}. Confirmation: ${confirmationNumber}. Source: Phone.`,
                bookingDetails: booking
            });
        } catch (emailErr) {
            console.error('⚠️ Failed to send restaurant notification email:', emailErr);
        }
    }

    // Send SMS notification to restaurant if they have a VAPI number and a phone number
    if (restaurant.phone && restaurant.vapi_phone_number && twilioService.isConfigured()) {
        try {
            const message = `TableNow AI: New booking via phone! ${guestName} for ${partySize} guests on ${date} at ${time}. Confirmation: ${confirmationNumber}`;
            await twilioService.sendSms(restaurant.phone, restaurant.vapi_phone_number, message);
            console.log(`SMS notification sent to ${restaurant.phone}`);
        } catch (smsError) {
            console.error('Failed to send SMS notification:', smsError);
            // Don't fail the booking if SMS fails
        }
    }

    // Create HubSpot contact and deal
    if (guestEmail) {
        try {
            await hubspotService.upsertContact({
                email: guestEmail,
                firstName: guestName.split(' ')[0],
                lastName: guestName.split(' ').slice(1).join(' '),
                phone: guestPhone,
                restaurantName: restaurant?.name
            });

            const deal = await hubspotService.createDeal({
                dealName: `${restaurant?.name} - ${guestName} - ${date}`,
                contactEmail: guestEmail,
                restaurantId,
                reservationDate: `${date} ${time}`,
                partySize
            });

            // Persist HubSpot deal id for lifecycle updates
            if (deal?.id) {
                await supabase
                    .from('bookings')
                    .update({ hubspot_deal_id: deal.id })
                    .eq('id', booking.id);
            }
        } catch (error) {
            console.error('HubSpot error:', error);
        }
    }

    return {
        success: true,
        confirmationNumber,
        message: `Perfect! Your reservation is confirmed for ${partySize} guests on ${date} at ${time}. Your confirmation number is ${confirmationNumber}. ${guestEmail ? 'A confirmation email has been sent to you.' : ''}`
    };
}

/**
 * Update booking function
 */
async function updateBooking(restaurantId: string, restaurant: any, params: any) {
    const { confirmationNumber, ...updates } = params;

    if (updates.time) {
        updates.time = normalizeTime(updates.time);
    }

    // 1. Update Database
    let { data: booking, error } = await supabase
        .from('bookings')
        .update(updates)
        .eq('restaurant_id', restaurantId)
        .eq('confirmation_number', confirmationNumber)
        .select()
        .single();

    // Fallback: try without restaurant filter in case of mismatch
    if ((error || !booking) && !updates.id) {
        const fallback = await supabase
            .from('bookings')
            .update(updates)
            .eq('confirmation_number', confirmationNumber)
            .select()
            .single();
        booking = fallback.data as any;
        error = fallback.error as any;
    }

    if (error || !booking) {
        return { success: false, message: 'Booking not found or update failed.' };
    }

    // 2. Update Google Calendar Event
    if (restaurant.google_calendar_tokens && booking.calendar_event_id && (updates.date || updates.time)) {
        try {
            console.log('📅 Updating Google Calendar event...');
            const tokens = JSON.parse(restaurant.google_calendar_tokens);

            // Re-calculate times if date/time changed
            const newDate = updates.date || booking.booking_date;
            const newTime = updates.time || booking.booking_time;
            const startTime = new Date(`${newDate}T${newTime}:00`);
            const endTime = new Date(startTime.getTime() + 90 * 60000);

            await calendarService.updateEvent(tokens, booking.calendar_event_id, {
                start: startTime,
                end: endTime,
                summary: `Reservation: ${booking.guest_name} (${updates.partySize || booking.party_size} ppl)`
            });
            console.log('✅ Google Calendar event updated');
        } catch (err) {
            console.error('⚠️ Google Calendar update error:', err);
        }
    }

    // Update HubSpot deal stage if available
    if (booking.hubspot_deal_id) {
        try {
            await hubspotService.updateDealStatus(booking.hubspot_deal_id, 'confirmed');
        } catch (hubspotError) {
            console.error('HubSpot update error:', hubspotError);
        }
    }

    return {
        success: true,
        message: 'Your booking has been updated successfully.'
    };
}

/**
 * Cancel booking function
 */
async function cancelBooking(restaurantId: string, restaurant: any, params: any) {
    const { confirmationNumber } = params;

    // 1. Get Booking to find Event ID
    let { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('confirmation_number', confirmationNumber)
        .single();

    if (!booking) {
        const fallback = await supabase
            .from('bookings')
            .select('*')
            .eq('confirmation_number', confirmationNumber)
            .single();
        booking = fallback.data || null;
    }

    if (!booking) {
        return { success: false, message: 'Booking not found.' };
    }

    // 2. Update Status in Database
    const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', booking.id);

    if (error) {
        return { success: false, message: 'Failed to cancel booking.' };
    }

    // 3. Delete from Google Calendar
    if (restaurant.google_calendar_tokens && booking.calendar_event_id) {
        try {
            console.log('📅 Deleting Google Calendar event...');
            const tokens = JSON.parse(restaurant.google_calendar_tokens);
            await calendarService.deleteEvent(tokens, booking.calendar_event_id);
            console.log('✅ Google Calendar event deleted');
        } catch (err) {
            console.error('⚠️ Google Calendar delete error:', err);
        }
    }

    // Update HubSpot deal stage if available
    if (booking.hubspot_deal_id) {
        try {
            await hubspotService.updateDealStatus(booking.hubspot_deal_id, 'cancelled');
        } catch (hubspotError) {
            console.error('HubSpot cancel error:', hubspotError);
        }
    }

    return {
        success: true,
        message: 'Your booking has been cancelled successfully.'
    };
}

/**
 * Answer question using RAG
 */
async function answerQuestion(restaurantId: string, restaurant: any, params: any) {
    const { question } = params;

    try {
        const answer = await ragService.generateAnswer(restaurantId, question, restaurant);
        return {
            success: true,
            answer
        };
    } catch (error) {
        console.error('Error answering question:', error);
        return {
            success: false,
            answer: 'I apologize, but I am having trouble finding that information. Please contact the restaurant directly.'
        };
    }
}

export default router;

function normalizeTime(timeStr?: string): string | undefined {
    if (!timeStr) return timeStr;
    // If already 24h HH:MM
    if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr;

    // Handle "HH:MM AM/PM"
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
    if (!match) return timeStr;
    let [_, hh, mm, mer] = match;
    let hour = parseInt(hh, 10);
    if (mer) {
        const upper = mer.toUpperCase();
        if (upper === 'PM' && hour < 12) hour += 12;
        if (upper === 'AM' && hour === 12) hour = 0;
    }
    const hh24 = hour.toString().padStart(2, '0');
    return `${hh24}:${mm}`;
}
