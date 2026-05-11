const { Router } = require('express');
const { pagarmeWebhook }           = require('../controllers/webhook.controller');
const { validateWebhookSignature } = require('../middlewares/webhook-auth.middleware');

const router = Router();

// Pagar.me chama este endpoint diretamente — protegido por HMAC-SHA256
router.post('/pagarme', validateWebhookSignature, pagarmeWebhook);

module.exports = router;
