const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getStats, getRevenue7Days, getBookingsToday, getPopularHours } = require('../controllers/dashboard.controller');

const router = Router();

router.get('/stats',          authenticate, getStats);
router.get('/revenue7days',   authenticate, getRevenue7Days);
router.get('/bookings-today', authenticate, getBookingsToday);
router.get('/popular-hours',  authenticate, getPopularHours);

module.exports = router;
