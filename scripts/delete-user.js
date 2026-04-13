/**
 * Script para remover completamente um usuário do sistema.
 * Deleta: FinancialInfo, Courts, Establishment, Subscription, User (DB) + Firebase Auth
 *
 * Uso: node scripts/delete-user.js <email>
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const admin  = require('../src/config/firebase');
const email = process.argv[2];

if (!email) {
  console.error('❌ Informe o e-mail: node scripts/delete-user.js <email>');
  process.exit(1);
}

async function run() {
  console.log(`\n🔍 Buscando usuário: ${email}\n`);

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      establishment: { include: { financial: true, courts: true } },
      subscription: true,
    },
  });

  if (!user) {
    console.log('⚠️  Usuário não encontrado no banco de dados.');
  } else {
    console.log(`👤 Usuário encontrado: ${user.id} (${user.name || 'sem nome'})`);

    if (user.establishment?.financial) {
      await prisma.financialInfo.delete({ where: { establishment_id: user.establishment.id } });
      console.log('✅ FinancialInfo deletada');
    }

    if (user.establishment?.courts?.length) {
      await prisma.court.deleteMany({ where: { establishment_id: user.establishment.id } });
      console.log(`✅ ${user.establishment.courts.length} quadra(s) deletada(s)`);
    }

    if (user.establishment) {
      await prisma.establishment.delete({ where: { id: user.establishment.id } });
      console.log('✅ Establishment deletado');
    }

    if (user.subscription) {
      await prisma.subscription.delete({ where: { id: user.subscription.id } });
      console.log('✅ Subscription deletada');
    }

    await prisma.user.delete({ where: { id: user.id } });
    console.log('✅ User deletado do banco');
  }

  // Firebase Auth
  try {
    const fbUser = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(fbUser.uid);
    console.log('✅ Usuário deletado do Firebase Auth');
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      console.log('⚠️  Usuário não encontrado no Firebase Auth');
    } else {
      console.error('❌ Erro ao deletar do Firebase:', e.message);
    }
  }

  console.log('\n🎉 Concluído!\n');
}

run()
  .catch(e => { console.error('❌ Erro:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
