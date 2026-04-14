const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getFinancial, saveFinancial, saveBankAccount, getRecipientStatus, getFinancialForm } = require('../controllers/financial.controller');

const router = Router();

router.use(authenticate);
router.get( '/me',               getFinancial);
router.get( '/me/form',          getFinancialForm);
router.post('/me',               saveFinancial);
router.post('/bank-account',     saveBankAccount);
router.get( '/recipient-status', getRecipientStatus);

module.exports = router;
