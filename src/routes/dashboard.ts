import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import supabase from '../config/supabase';
import { normalizeBooking } from '../services/booking.service';
import { DatabaseError } from '../lib/errors';

const router = Router();
router.use(authenticateToken);

// ─── GET /dashboard/stats ─────────────────────────────────────────────────────

router.get('/stats', async (req: AuthRequest, res: Response, next) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const { startDate, endDate } = req.query as Record<string, string>;

        let bookingsQuery = supabase
            .from('bookings')
            .select('*, customers(name, email, phone)', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false });

        if (startDate) bookingsQuery = bookingsQuery.or(
            `booking_date.gte.${startDate},booked_for.gte.${startDate}T00:00:00`
        );
        if (endDate) bookingsQuery = bookingsQuery.or(
            `booking_date.lte.${endDate},booked_for.lte.${endDate}T23:59:59`
        );

        const { data: rawBookings, count: totalBookings, error: bErr } = await bookingsQuery;
        if (bErr) throw new DatabaseError('Failed to fetch bookings', bErr);

        const bookings = (rawBookings || []).map(normalizeBooking);

        let callsQuery = supabase
            .from('call_logs')
            .select('*', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false });

        if (startDate) callsQuery = callsQuery.gte('created_at', startDate);
        if (endDate)   callsQuery = callsQuery.lte('created_at', endDate);

        const { data: calls, count: totalCalls, error: cErr } = await callsQuery;
        if (cErr) throw new DatabaseError('Failed to fetch call logs', cErr);

        const confirmed  = bookings.filter((b: any) => b.status === 'confirmed').length;
        const cancelled  = bookings.filter((b: any) => b.status === 'cancelled').length;
        const totalGuests = bookings.reduce((s: number, b: any) => s + (b.party_size || 0), 0);
        const bySource   = bookings.reduce((acc: any, b: any) => {
            const k = b.source || 'unknown';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {});

        const successfulCalls = (calls || []).filter((c: any) => c.status === 'completed').length;
        const avgDuration = calls?.length
            ? Math.round(calls.reduce((s, c: any) => s + (c.duration || 0), 0) / calls.length)
            : 0;

        res.json({
            bookings: {
                total: totalBookings ?? 0,
                confirmed,
                cancelled,
                totalGuests,
                avgPartySize: totalBookings ? (totalGuests / totalBookings).toFixed(1) : 0,
                bySource
            },
            calls: { total: totalCalls ?? 0, successful: successfulCalls, avgDuration },
            recent: {
                bookings: bookings.slice(0, 10),
                calls: (calls || []).slice(0, 10)
            }
        });
    } catch (err) { next(err); }
});

// ─── GET /dashboard/calls ─────────────────────────────────────────────────────

router.get('/calls', async (req: AuthRequest, res: Response, next) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const limit  = Math.min(Number(req.query.limit)  || 50, 200);
        const offset = Number(req.query.offset) || 0;

        const { data: calls, error, count } = await supabase
            .from('call_logs')
            .select('*', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw new DatabaseError('Failed to fetch call logs', error);
        res.json({ calls, total: count, limit, offset });
    } catch (err) { next(err); }
});

export default router;
