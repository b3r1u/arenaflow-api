const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getStats, getRevenue7Days, getBookingsToday, getPopularHours, getReport } = require('../controllers/dashboard.controller');

const router = Router();

router.get('/stats',          authenticate, getStats);
router.get('/revenue7days',   authenticate, getRevenue7Days);
router.get('/bookings-today', authenticate, getBookingsToday);
router.get('/popular-hours',  authenticate, getPopularHours);
router.get('/report',         authenticate, getReport);

module.exports = router;
