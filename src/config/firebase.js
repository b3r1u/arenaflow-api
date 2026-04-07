const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

if (!admin.apps.length) {
  // Prioridade 1: variável de ambiente com o JSON completo (produção/Railway)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase Admin inicializado via variável de ambiente');
    } catch (e) {
      console.error('\n❌ FIREBASE_SERVICE_ACCOUNT_JSON inválido. Abortando.\n');
      process.exit(1);
    }
  } else {
    // Prioridade 2: arquivo local (desenvolvimento)
    const serviceAccountPath = path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json'
    );

    if (!fs.existsSync(serviceAccountPath)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '\n⚠️  firebase-service-account.json não encontrado.',
          '\n   Endpoints públicos funcionam normalmente.',
          '\n   Endpoints protegidos retornarão 503 até a chave ser configurada.\n'
        );
      } else {
        console.error('\n❌ Firebase não configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON. Abortando.\n');
        process.exit(1);
      }
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
      });
      console.log('✅ Firebase Admin inicializado via arquivo local');
    }
  }
}

module.exports = admin;
