const { Router }       = require('express');
const arenasController = require('../controllers/arenas.controller');

const router = Router();

// Rotas públicas — consumidas pelo app do cliente (arenaflow-booking)

// GET /api/arenas        — lista todas as arenas ativas (com filtro opcional)
router.get('/',           arenasController.list);

// GET /api/arenas/:id    — retorna uma arena específica com suas quadras
router.get('/:id',        arenasController.getById);

module.exports = router;
