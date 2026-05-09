const { Router }    = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { sendMessage }  = require('../controllers/support.controller');

const router = Router();

router.post('/message', authenticate, sendMessage);

module.exports = router;
