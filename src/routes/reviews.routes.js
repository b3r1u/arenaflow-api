const { Router }   = require('express');
const { authenticateClient } = require('../middlewares/auth.middleware');
const { create, getMyReviewedBookingIds } = require('../controllers/reviews.controller');

const router = Router();

// GET  /api/reviews/mine — reservas já avaliadas pelo usuário autenticado
router.get('/mine', authenticateClient, getMyReviewedBookingIds);

// POST /api/reviews — cria avaliação (cliente, auto-cria user se não existir)
router.post('/', authenticateClient, create);

module.exports = router;
