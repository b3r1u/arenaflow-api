const { PrismaClient } = require('../../generated/prisma');

// Reutiliza a instância em desenvolvimento para não esgotar conexões
const prisma = global.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

if (process.env.NODE_ENV === 'development') {
  global.__prisma = prisma;
}

module.exports = prisma;
