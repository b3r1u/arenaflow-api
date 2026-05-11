process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARN] unhandledRejection:', reason);
  // Não encerra o processo — mantém a API no ar
});

try {
  require('dotenv').config();

  // ─── Validações de startup (C7) ───────────────────────────────────────────
  // Garante que variáveis críticas estão presentes e válidas antes de aceitar tráfego
  const REQUIRED_VARS = [
    'DATABASE_URL',
    'PAGARME_API_KEY',
    'ENCRYPTION_KEY',
    'PLATFORM_ADMIN_EMAIL',
  ];

  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('[FATAL] Variáveis de ambiente obrigatórias ausentes:', missing.join(', '));
    process.exit(1);
  }

  // Valida ENCRYPTION_KEY: deve ter exatamente 64 chars hex (32 bytes para AES-256)
  const encKey = process.env.ENCRYPTION_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    console.error('[FATAL] ENCRYPTION_KEY inválida — deve ter 64 caracteres hexadecimais (32 bytes)');
    process.exit(1);
  }

  // Aviso se webhook secret não configurado
  if (!process.env.PAGARME_WEBHOOK_SECRET) {
    console.warn('[WARN] PAGARME_WEBHOOK_SECRET não configurado — autenticação de webhook desabilitada');
  }

  const app  = require('./src/app');
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`\n🚀 ArenaFlow API rodando na porta ${PORT}`);
    console.log(`   Ambiente : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   URL      : http://localhost:${PORT}\n`);
  });
} catch (err) {
  console.error('[FATAL] Erro ao iniciar servidor:', err);
  process.exit(1);
}
