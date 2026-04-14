import { Router } from 'express';
import { prefillRestaurant, autocompleteRestaurant } from '../controllers/prefillRestaurant';

const router = Router();
router.post('/api/restaurants/prefill', prefillRestaurant);
router.post('/api/restaurants/autocomplete', autocompleteRestaurant);
export default router;
