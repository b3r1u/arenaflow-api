require('dotenv').config();
const prisma = require('./src/lib/prisma');

async function main() {
  const email = 'roberioalbuquerque.neto@gmail.com';

  // 1. Busca o plano free
  const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });
  if (!freePlan) { console.error('Plano free não encontrado no banco!'); return; }
  console.log('Plano free encontrado:', freePlan.id);

  // 2. Promove o usuário para ADMIN
  const user = await prisma.user.update({
    where: { email },
    data: { role: 'ADMIN' },
  });
  console.log('Usuário promovido para ADMIN:', user.id);

  // 3. Cria (ou atualiza) a assinatura com plano free e status ACTIVE
  const sub = await prisma.subscription.upsert({
    where:  { user_id: user.id },
    create: {
      user_id:  user.id,
      plan_id:  freePlan.id,
      status:   'ACTIVE',
    },
    update: {
      plan_id: freePlan.id,
      status:  'ACTIVE',
      trial_ends_at: null,
    },
  });
  console.log('Assinatura criada/atualizada:', sub.id, '| status:', sub.status, '| plan_id:', sub.plan_id);
  console.log('Pronto! roberioalbuquerque.neto@gmail.com pode logar como ADMIN no plano Free.');
}

main().catch(console.error).finally(() => process.exit());
