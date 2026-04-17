const { Router } = require('express');
const { pagarmeWebhook } = require('../controllers/webhook.controller');

const router = Router();

// Endpoint público — Pagar.me chama diretamente
router.post('/pagarme', pagarmeWebhook);

module.exports = router;
