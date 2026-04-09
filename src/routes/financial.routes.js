const { Router } = require('express');
const multer     = require('multer');
const { authenticate }   = require('../middlewares/auth.middleware');
const { getFinancial, saveFinancial, saveBankAccount, saveDocument } = require('../controllers/financial.controller');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

router.use(authenticate);
router.get( '/me',           getFinancial);
router.post('/me',           saveFinancial);
router.post('/bank-account', saveBankAccount);
router.post('/document',     upload.single('documentFile'), saveDocument);

module.exports = router;
