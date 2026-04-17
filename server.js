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
