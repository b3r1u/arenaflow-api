require('dotenv').config();
const prisma = require('./src/lib/prisma');
const { cancelCharge, getCharge } = require('./src/lib/pagarme.service');

async function main() {
  const chargeId    = 'ch_YgOJDGasP4i0OvNa';
  const bookingId   = '9efcd04a-e3ba-41be-81e6-d4c7e03f84d6';
  const refundCents = 200; // R$2,00 pagos via PIX direto

  console.log('Consultando charge', chargeId, '...');
  const charge = await getCharge(chargeId);
  console.log('Status atual na Pagar.me:', charge.status);

  if (charge.status === 'refunded') {
    console.log('Charge já estava estornada. Nenhuma ação necessária.');
    await prisma.$disconnect();
    return;
  }

  if (charge.status !== 'paid') {
    console.log('Charge não está paga (status:', charge.status, '). Estorno não aplicável.');
    await prisma.$disconnect();
    return;
  }

  console.log('Solicitando estorno de R$', (refundCents / 100).toFixed(2), '...');
  await cancelCharge(chargeId, refundCents);
  console.log('Estorno solicitado com sucesso!');

  await prisma.$disconnect();
}

main().catch(console.error);
