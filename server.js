require('dotenv').config();

// DEBUG TEMPORÁRIO — remover após confirmar deploy
console.log('[DEBUG] ENV KEYS:', Object.keys(process.env).join(', '));
console.log('[DEBUG] FIREBASE_JSON:', process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? `SET (${process.env.FIREBASE_SERVICE_ACCOUNT_JSON.length} chars)` : 'NOT SET');
console.log('[DEBUG] NODE_ENV:', process.env.NODE_ENV);

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 ArenaFlow API rodando na porta ${PORT}`);
  console.log(`   Ambiente : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   URL      : http://localhost:${PORT}\n`);
});
