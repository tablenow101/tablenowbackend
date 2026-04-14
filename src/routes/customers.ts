import { Router, Request, Response } from 'express';
import supabase from '../config/supabase';

const router = Router();

// ─────────────────────────────────────────
// DELETE /api/bookings/:id
// Soft delete — status = cancelled
// ─────────────────────────────────────────
router.delete('/bookings/:id', async (req: Request, res: Response) => {
    const { data, error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Réservation annulée', booking: data });
});

// ─────────────────────────────────────────
// GET /api/customers?phone=+33612345678
// Profil complet d'un convive + historique réservations
// ─────────────────────────────────────────
router.get('/customers', async (req: Request, res: Response) => {
    const { phone } = req.query as { phone?: string };

    if (!phone) {
        return res.status(400).json({ error: 'Paramètre phone requis' });
    }

    const { data, error } = await supabase
        .from('customers')
        .select('*, bookings(*)')
        .eq('phone', phone)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Client introuvable' });
    res.json(data);
});

// ─────────────────────────────────────────
// PATCH /api/customers/:id
// Mettre à jour allergies, préférences, notes
// ─────────────────────────────────────────
router.patch('/customers/:id', async (req: Request, res: Response) => {
    const { name, email, allergies, preferences, notes } = req.body;

    const updates: Record<string, any> = {};
    if (name !== undefined)       updates.name = name;
    if (email !== undefined)      updates.email = email;
    if (allergies !== undefined)  updates.allergies = allergies;
    if (preferences !== undefined) updates.preferences = preferences;
    if (notes !== undefined)      updates.notes = notes;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('customers')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ─────────────────────────────────────────
// POST /api/internal/mark-noshows
// Marquer no_show les réservations confirmées
// dont l'heure est passée de plus de 30 min
// Appelé par cron VPS toutes les heures
// ─────────────────────────────────────────
router.post('/internal/mark-noshows', async (req: Request, res: Response) => {
    // Simple secret check — not exposed to frontend
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase.rpc('mark_noshows');
    if (error) return res.status(500).json({ error: error.message });

    const count = (data as any)?.count ?? 0;
    console.log(`[no-show cron] ${count} réservations marquées no_show`);
    res.json({ marked: count });
});

export default router;
