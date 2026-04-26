const { Router } = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const { create, getById, getMyBookings, simulatePayment, getAvailability, getCancelPreview, cancel } = require('../controllers/bookings.controller');
const { createPaymentGroup, getPaymentGroup, regenerateSplit } = require('../controllers/payment.controller');

const router = Router();

router.get('/availability',          getAvailability);               // público
router.post('/',                     authenticateClient, create);
router.get('/me',                    authenticateClient, getMyBookings);
router.get('/:id',                   authenticateClient, getById);
router.post('/:id/simulate-payment', authenticateClient, simulatePayment);

// Cancelamento (com aplicação da política da arena)
router.get('/:id/cancel-preview',    authenticateClient, getCancelPreview);
router.post('/:id/cancel',           authenticateClient, cancel);

// Pagamento via Pix com divisão entre jogadores
router.post('/:id/payment-group',                   authenticateClient, createPaymentGroup);
router.get('/:id/payment-group',                    authenticateClient, getPaymentGroup);
router.post('/:id/splits/:splitId/regenerate',      authenticateClient, regenerateSplit);

module.exports = router;
