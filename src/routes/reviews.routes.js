const { Router }   = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const { create }   = require('../controllers/reviews.controller');

const router = Router();

// POST /api/reviews — autenticado (cliente, auto-cria user se não existir)
router.post('/', authenticateClient, create);

module.exports = router;
