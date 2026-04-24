const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const { listByDate, listByMonth, create, update, cancel } = require('../controllers/admin.bookings.controller');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/month', listByMonth);   // GET /api/admin/bookings/month?month=YYYY-MM
router.get('/',      listByDate);
router.post('/',     create);
router.patch('/:id', update);
router.delete('/:id', cancel);

module.exports = router;
