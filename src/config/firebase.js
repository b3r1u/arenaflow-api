const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

if (!admin.apps.length) {
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
      console.error('\n❌ firebase-service-account.json não encontrado. Abortando.\n');
      process.exit(1);
    }
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath)),
    });
    console.log('✅ Firebase Admin inicializado');
  }
}

module.exports = admin;
