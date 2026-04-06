const { Router }                     = require('express');
const courtsController               = require('../controllers/courts.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

const router = Router();

// Todas as rotas exigem admin autenticado
router.use(authenticate, requireAdmin);

// GET    /api/courts       — lista quadras do estabelecimento
router.get('/',            courtsController.list);

// POST   /api/courts       — cria uma quadra
router.post('/',           courtsController.create);

// PATCH  /api/courts/:id   — atualiza uma quadra
router.patch('/:id',       courtsController.update);

// DELETE /api/courts/:id   — remove (soft-delete) uma quadra
router.delete('/:id',      courtsController.remove);

module.exports = router;
