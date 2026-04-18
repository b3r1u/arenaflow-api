const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getMe, updateMe } = require('../controllers/users.controller');

const router = Router();

router.use(authenticate);
router.get( '/me', getMe);
router.put(  '/me', updateMe);

module.exports = router;
