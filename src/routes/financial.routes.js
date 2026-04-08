const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getFinancial, saveFinancial } = require('../controllers/financial.controller');

const router = Router();

router.use(authenticate);
router.get('/me',  getFinancial);
router.post('/me', saveFinancial);

module.exports = router;
