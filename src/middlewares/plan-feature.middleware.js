const prisma               = require('../lib/prisma');
const { getFeaturesForSlug } = require('../lib/plan-features');

/**
 * Middleware factory — verifica se o plano do usuário inclui a feature solicitada.
 * Deve ser usado APÓS `authenticate` + `requireAdmin`.
 *
 * Em caso de sucesso injeta `req.planFeatures` e `req.subscription`.
 */
function requireFeature(featureName) {
  return async (req, res, next) => {
    try {
      const sub = await prisma.subscription.findUnique({
        where:   { user_id: req.user.id },
        include: { plan: true },
      });

      if (!sub) {
        return res.status(403).json({
          error: 'Assinatura não encontrada',
          code:  'NO_SUBSCRIPTION',
        });
      }

      const features = getFeaturesForSlug(sub.plan.slug);

      if (!features[featureName]) {
        return res.status(403).json({
          error:   `Esta funcionalidade não está disponível no plano ${sub.plan.name}. Faça upgrade para continuar.`,
          code:    'PLAN_LIMIT',
          feature: featureName,
          plan:    sub.plan.slug,
        });
      }

      req.planFeatures = features;
      req.subscription = sub;
      next();
    } catch (err) {
      console.error('[requireFeature]', err);
      return res.status(500).json({ error: 'Erro ao verificar assinatura' });
    }
  };
}

/**
 * Middleware — verifica se o estabelecimento pode criar mais quadras (limite do plano).
 * Deve ser usado APÓS `authenticate` + `requireAdmin` e apenas na rota POST de quadras.
 */
function requireMaxCourts() {
  return async (req, res, next) => {
    try {
      const sub = await prisma.subscription.findUnique({
        where:   { user_id: req.user.id },
        include: { plan: true },
      });

      if (!sub) {
        return res.status(403).json({
          error: 'Assinatura não encontrada',
          code:  'NO_SUBSCRIPTION',
        });
      }

      const maxCourts = sub.plan.max_courts; // null = ilimitado

      if (maxCourts !== null) {
        const establishment = await prisma.establishment.findUnique({
          where:  { owner_id: req.user.id },
          select: {
            _count: { select: { courts: { where: { active: true } } } },
          },
        });

        const currentCount = establishment?._count?.courts ?? 0;

        if (currentCount >= maxCourts) {
          return res.status(403).json({
            error:          `Limite de ${maxCourts} quadra(s) atingido no plano ${sub.plan.name}. Faça upgrade para adicionar mais quadras.`,
            code:           'COURT_LIMIT',
            max_courts:     maxCourts,
            current_courts: currentCount,
            plan:           sub.plan.slug,
          });
        }
      }

      req.planFeatures = getFeaturesForSlug(sub.plan.slug);
      req.subscription  = sub;
      next();
    } catch (err) {
      console.error('[requireMaxCourts]', err);
      return res.status(500).json({ error: 'Erro ao verificar limite de quadras' });
    }
  };
}

module.exports = { requireFeature, requireMaxCourts };
