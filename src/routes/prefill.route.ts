import { Router } from 'express';
import { prefillRestaurant } from '../controllers/prefillRestaurant';

const router = Router();
router.post('/api/restaurants/prefill', prefillRestaurant);
export default router;
