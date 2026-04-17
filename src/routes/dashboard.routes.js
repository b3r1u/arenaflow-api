const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getStats, getRevenue7Days } = require('../controllers/dashboard.controller');

const router = Router();

router.get('/stats',        authenticate, getStats);
router.get('/revenue7days', authenticate, getRevenue7Days);

module.exports = router;
