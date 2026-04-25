const { Router } = require('express');
const { getPublicBooking } = require('../controllers/public.booking.controller');

const router = Router();

// GET /api/reserva/:id — público, sem autenticação
router.get('/:id', getPublicBooking);

module.exports = router;
