const { Router } = require('express');
const multer     = require('multer');
const { authenticate } = require('../middlewares/auth.middleware');
const { getFinancial, saveFinancial, saveBankAccount, getDocumentLinks, saveDocument, getFinancialForm } = require('../controllers/financial.controller');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

router.use(authenticate);
router.get( '/me',                  getFinancial);
router.get( '/me/form',             getFinancialForm);
router.post('/me',                  saveFinancial);
router.post('/bank-account',        saveBankAccount);
router.get( '/document-links',      getDocumentLinks);
router.post('/document/:groupId',   upload.single('documentFile'), saveDocument);

module.exports = router;
