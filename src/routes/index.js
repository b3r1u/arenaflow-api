const { Router } = require('express');

const authRoutes          = require('./auth.routes');
const plansRoutes         = require('./plans.routes');
const establishmentRoutes = require('./establishments.routes');
const courtsRoutes        = require('./courts.routes');
const arenasRoutes        = require('./arenas.routes');
const financialRoutes     = require('./financial.routes');

const router = Router();

router.use('/auth',           authRoutes);
router.use('/plans',          plansRoutes);
router.use('/establishments', establishmentRoutes);
router.use('/courts',         courtsRoutes);
router.use('/arenas',         arenasRoutes);      // público — app cliente
router.use('/financial',      financialRoutes);

module.exports = router;
