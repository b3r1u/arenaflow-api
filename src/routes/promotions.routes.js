const { Router } = require('express');
const { authMiddleware } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/promotions.controller');

// Rotas admin (autenticadas)
const adminRouter = Router();
adminRouter.use(authMiddleware);
adminRouter.get('/',           ctrl.list);
adminRouter.post('/',          ctrl.create);
adminRouter.put('/:id',        ctrl.update);
adminRouter.patch('/:id/toggle', ctrl.toggle);
adminRouter.delete('/:id',     ctrl.remove);

// Rota pública (usada pelo app cliente via /api/arenas/:arenaId/promotions)
const publicRouter = Router({ mergeParams: true });
publicRouter.get('/', ctrl.publicList);

module.exports = { adminRouter, publicRouter };
