const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const { listByDate, create, update, cancel } = require('../controllers/admin.bookings.controller');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/',      listByDate);
router.post('/',     create);
router.patch('/:id', update);
router.delete('/:id', cancel);

module.exports = router;
