const { Router } = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const { create, getById, getMyBookings, simulatePayment, getAvailability } = require('../controllers/bookings.controller');

const router = Router();

router.get('/availability',          getAvailability);               // público
router.post('/',                     authenticateClient, create);
router.get('/me',                    authenticateClient, getMyBookings);
router.get('/:id',                   authenticateClient, getById);
router.post('/:id/simulate-payment', authenticateClient, simulatePayment);

module.exports = router;
