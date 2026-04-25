const { Router } = require('express');

const authRoutes          = require('./auth.routes');
const plansRoutes         = require('./plans.routes');
const establishmentRoutes = require('./establishments.routes');
const courtsRoutes        = require('./courts.routes');
const arenasRoutes        = require('./arenas.routes');
const financialRoutes     = require('./financial.routes');
const webhookRoutes       = require('./webhook.routes');
const bookingsRoutes      = require('./bookings.routes');
const dashboardRoutes     = require('./dashboard.routes');
const clientsRoutes       = require('./clients.routes');
const adminBookingsRoutes = require('./admin.bookings.routes');
const usersRoutes         = require('./users.routes');
const reviewsRoutes        = require('./reviews.routes');
const publicBookingRoutes  = require('./public.booking.routes');

const router = Router();

router.use('/auth',           authRoutes);
router.use('/plans',          plansRoutes);
router.use('/establishments', establishmentRoutes);
router.use('/courts',         courtsRoutes);
router.use('/arenas',         arenasRoutes);          // público — app cliente
router.use('/financial',      financialRoutes);
router.use('/webhook',        webhookRoutes);          // webhooks externos (ASAAS etc)
router.use('/bookings',       bookingsRoutes);         // reservas do app cliente
router.use('/dashboard',      dashboardRoutes);        // métricas do admin
router.use('/clients',        clientsRoutes);          // clientes do admin
router.use('/admin/bookings', adminBookingsRoutes);    // agendamentos do admin
router.use('/users',         usersRoutes);             // perfil do usuário cliente
router.use('/reviews',       reviewsRoutes);           // avaliações de arenas
router.use('/reserva',       publicBookingRoutes);      // consulta pública de reserva (link compartilhável)

module.exports = router;
