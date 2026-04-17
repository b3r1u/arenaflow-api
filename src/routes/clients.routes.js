const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const { listClients } = require('../controllers/clients.controller');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', listClients);

module.exports = router;
