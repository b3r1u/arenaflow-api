const { Router } = require('express');
const authController = require('../controllers/auth.controller');

const router = Router();

// POST /api/auth/me — cria ou retorna o usuário após login no Firebase
router.post('/me', authController.me);

module.exports = router;
