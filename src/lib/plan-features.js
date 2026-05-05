/**
 * Mapa de funcionalidades por slug de plano.
 * Fonte única de verdade — usada tanto pela API (middleware) quanto pode ser
 * referenciada pelo frontend (via /api/auth/me que retorna o plano).
 */
const PLAN_FEATURES = {
  free: {
    max_courts:        1,
    mensalistas:       false,
    promotions:        false,
    advanced_reports:  false,
    split_payment:     false,
    multi_user:        false,
    dashboard_advanced: false,
    commission_percent: 8,
  },
  essencial: {
    max_courts:        2,
    mensalistas:       true,
    promotions:        true,
    advanced_reports:  false,
    split_payment:     false,
    multi_user:        false,
    dashboard_advanced: true,
    commission_percent: 5,
  },
  pro: {
    max_courts:        5,
    mensalistas:       true,
    promotions:        true,
    advanced_reports:  true,
    split_payment:     true,
    multi_user:        false,
    dashboard_advanced: true,
    commission_percent: 3,
  },
  business: {
    max_courts:        10,
    mensalistas:       true,
    promotions:        true,
    advanced_reports:  true,
    split_payment:     true,
    multi_user:        true,
    dashboard_advanced: true,
    commission_percent: 0,
  },
};

/**
 * Retorna as features do plano pelo slug.
 * Fallback para 'free' se o slug não for reconhecido.
 */
function getFeaturesForSlug(slug) {
  return PLAN_FEATURES[slug] ?? PLAN_FEATURES['free'];
}

module.exports = { PLAN_FEATURES, getFeaturesForSlug };
