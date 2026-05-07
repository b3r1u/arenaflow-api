const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/subscription.controller');

const router = Router();

router.use(authenticate);

router.post('/',    ctrl.create);   // assinar plano pago
router.delete('/me', ctrl.cancel);  // cancelar assinatura

module.exports = router;
