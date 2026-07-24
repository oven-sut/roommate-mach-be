import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.swipe.deleteMany();
  console.log(`Deleted ${result.count} swipe records.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
