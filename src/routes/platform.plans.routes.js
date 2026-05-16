const { Router }                              = require('express');
const { authenticate, requirePlatformAdmin }  = require('../middlewares/auth.middleware');
const ctrl                                    = require('../controllers/platform.plans.controller');

const router = Router();

// Todas as rotas exigem autenticação + ser admin da plataforma
router.use(authenticate, requirePlatformAdmin);

// GET    /api/platform/plans             — lista todos os planos
router.get('/',                    ctrl.list);

// POST   /api/platform/plans             — cria um novo plano
router.post('/',                   ctrl.create);

// PUT    /api/platform/plans/:id         — atualiza um plano
router.put('/:id',                 ctrl.update);

// POST   /api/platform/plans/:id/sync    — sincroniza com o Pagar.me
router.post('/:id/sync',           ctrl.syncPagarme);

// GET    /api/platform/plans/:id/subscribers — lista assinantes do plano
router.get('/:id/subscribers',     ctrl.getSubscribers);

module.exports = router;
