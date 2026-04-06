const { Router }                     = require('express');
const establishmentsController       = require('../controllers/establishments.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

const router = Router();

// Todas as rotas exigem admin autenticado
router.use(authenticate, requireAdmin);

// GET   /api/establishments/me — retorna o estabelecimento do admin
router.get('/me',    establishmentsController.getMyEstablishment);

// POST  /api/establishments    — cria o estabelecimento
router.post('/',     establishmentsController.create);

// PATCH /api/establishments/me — atualiza o estabelecimento
router.patch('/me',  establishmentsController.update);

module.exports = router;
