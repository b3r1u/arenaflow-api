const { Router } = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const {
  create, listMe, getOne, cancel,
} = require('../controllers/mensalistas.controller');

const router = Router();

// Rotas do cliente
router.post('/',        authenticateClient, create);    // criar mensalista
router.get('/me',       authenticateClient, listMe);    // listar próprios
router.get('/:id',      authenticateClient, getOne);    // detalhe
router.delete('/:id',   authenticateClient, cancel);    // cancelar

module.exports = router;
