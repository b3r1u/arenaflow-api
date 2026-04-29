const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const { adminList, adminInativar } = require('../controllers/mensalistas.controller');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/',                    adminList);       // listar mensalistas da arena
router.patch('/:id/inativar',      adminInativar);   // inativar manualmente

module.exports = router;
