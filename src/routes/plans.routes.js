const { Router }                  = require('express');
const plansController             = require('../controllers/plans.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

const router = Router();

// GET  /api/plans                   — lista planos (público)
router.get('/',                    plansController.list);

// GET  /api/plans/my-subscription   — assinatura do admin autenticado
router.get('/my-subscription',     authenticate, requireAdmin, plansController.mySubscription);

// POST /api/plans/trial             — inicia trial de 7 dias
router.post('/trial',              authenticate, requireAdmin, plansController.startTrial);

module.exports = router;
