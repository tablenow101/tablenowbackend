import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import supabase from '../config/supabase';

const router = Router();
router.use(authenticateToken);

/**
 * Get dashboard statistics
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const { startDate, endDate } = req.query;

        // Fetch bookings — join customers for VAPI-created entries (customer_id FK)
        // Order by created_at (works for both schemas — booking_date is null for VAPI bookings)
        let bookingsQuery = supabase
            .from('bookings')
            .select('*, customers(name, email, phone)', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false });

        // Date filter: support both booking_date (manual) and booked_for (VAPI)
        if (startDate) {
            bookingsQuery = bookingsQuery.or(
                `booking_date.gte.${startDate},booked_for.gte.${startDate}T00:00:00`
            );
        }
        if (endDate) {
            bookingsQuery = bookingsQuery.or(
                `booking_date.lte.${endDate},booked_for.lte.${endDate}T23:59:59`
            );
        }

        const { data: rawBookings, count: totalBookings } = await bookingsQuery;

        // Normalize: unify both booking schemas for the frontend
        const bookings = (rawBookings || []).map((b: any) => {
            let bookingDate = b.booking_date;
            let bookingTime = b.booking_time;
            if (!bookingDate && b.booked_for) {
                const dt = new Date(b.booked_for);
                bookingDate = dt.toISOString().split('T')[0];
                bookingTime = dt.toTimeString().slice(0, 5);
            }
            const customer = b.customers;
            return {
                ...b,
                booking_date: bookingDate,
                booking_time: bookingTime,
                guest_name:  b.guest_name  || customer?.name  || 'N/A',
                guest_email: b.guest_email || customer?.email || null,
                guest_phone: b.guest_phone || customer?.phone || null,
                party_size:  b.party_size  ?? b.covers        ?? null,
                customers: undefined,
            };
        });

        // Call logs
        let callsQuery = supabase
            .from('call_logs')
            .select('*', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false });

        if (startDate) callsQuery = callsQuery.gte('created_at', startDate);
        if (endDate)   callsQuery = callsQuery.lte('created_at', endDate);

        const { data: calls, count: totalCalls } = await callsQuery;

        // Stats
        const confirmedBookings = bookings.filter((b: any) => b.status === 'confirmed').length;
        const cancelledBookings = bookings.filter((b: any) => b.status === 'cancelled').length;
        const totalGuests = bookings.reduce((sum: number, b: any) => sum + (b.party_size || 0), 0);
        const avgPartySize = totalBookings ? (totalGuests / totalBookings).toFixed(1) : 0;

        const successfulCalls = calls?.filter((c: any) => c.status === 'completed').length || 0;
        const avgCallDuration = calls?.length
            ? (calls.reduce((sum: number, c: any) => sum + (c.duration || 0), 0) / calls.length).toFixed(0)
            : 0;

        const bookingsBySource = bookings.reduce((acc: any, b: any) => {
            acc[b.source || 'unknown'] = (acc[b.source || 'unknown'] || 0) + 1;
            return acc;
        }, {});

        res.json({
            bookings: {
                total: totalBookings,
                confirmed: confirmedBookings,
                cancelled: cancelledBookings,
                totalGuests,
                avgPartySize,
                bySource: bookingsBySource
            },
            calls: {
                total: totalCalls,
                successful: successfulCalls,
                avgDuration: avgCallDuration
            },
            recent: {
                bookings: bookings.slice(0, 10),
                calls: (calls || []).slice(0, 10)
            }
        });
    } catch (error: any) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});
;

/**
 * Get call logs
 */
router.get('/calls', async (req: AuthRequest, res: Response) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const { limit = 50, offset = 0 } = req.query;

        const { data: calls, error, count } = await supabase
            .from('call_logs')
            .select('*', { count: 'exact' })
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (error) {
            return res.status(500).json({ error: 'Failed to fetch call logs' });
        }

        res.json({ calls, total: count, limit: Number(limit), offset: Number(offset) });
    } catch (error: any) {
        console.error('Get calls error:', error);
        res.status(500).json({ error: 'Failed to fetch call logs' });
    }
});

export default router;
