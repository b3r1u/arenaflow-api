const { Router } = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const {
  create, listMe, getOne, cancel, renovar, reemitirPix, slots,
} = require('../controllers/mensalistas.controller');

const router = Router();

// Rota pública (sem auth) — slots bloqueados por mensalistas
router.get('/slots', slots);

// Rotas do cliente
router.post('/',        authenticateClient, create);    // criar mensalista
router.get('/me',       authenticateClient, listMe);    // listar próprios
router.get('/:id',          authenticateClient, getOne);    // detalhe
router.post('/:id/renovar',      authenticateClient, renovar);      // renovar mensalista
router.post('/:id/reemitir-pix', authenticateClient, reemitirPix);  // reemitir PIX pendente
router.delete('/:id',       authenticateClient, cancel);    // cancelar

module.exports = router;
