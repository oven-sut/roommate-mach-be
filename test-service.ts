import { PrismaClient } from '@prisma/client';
import { FeaturesService } from './src/features/features.service';

const prisma = new PrismaClient();

async function test() {
  const service = new FeaturesService(prisma as any);
  
  const user = await prisma.user.findFirst();
  if (!user) return console.log("No users");

  const page1 = await service.discover(user.id, "1");
  console.log("Page 1 count:", page1.length);
  
  const page2 = await service.discover(user.id, "2");
  console.log("Page 2 count:", page2.length);

  const page3 = await service.discover(user.id, "3");
  console.log("Page 3 count:", page3.length);

  const page4 = await service.discover(user.id, "4");
  console.log("Page 4 count:", page4.length);

  await prisma.$disconnect();
}
test();
