const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

if (!admin.apps.length) {
  const serviceAccountPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json'
  );

  if (!fs.existsSync(serviceAccountPath)) {
    console.error(
      '\n❌ firebase-service-account.json não encontrado em:', serviceAccountPath,
      '\n   Gere a chave em: Firebase Console → Configurações → Contas de serviço\n'
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
  });

  console.log('✅ Firebase Admin inicializado');
}

module.exports = admin;
