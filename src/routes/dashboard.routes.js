const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getStats } = require('../controllers/dashboard.controller');

const router = Router();

router.get('/stats', authenticate, getStats);

module.exports = router;
