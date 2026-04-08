const { Router } = require('express');
const { asaasWebhook } = require('../controllers/webhook.controller');

const router = Router();

// Endpoint público — sem authenticate (ASAAS chama diretamente)
router.post('/asaas', asaasWebhook);

module.exports = router;
