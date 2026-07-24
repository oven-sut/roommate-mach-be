import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  const user = await prisma.user.findFirst();
  if (!user) return console.log("No users found");

  const userId = user.id;

  try {
    const rawUsers = await prisma.$queryRaw<Array<{id: string, score: number}>>`
      SELECT u.id,
        COALESCE(
          55 + (40.0 * 
            SUM(CASE WHEN a1.selections = a2.selections THEN 1 ELSE 0 END) 
            / NULLIF(COUNT(a1."questionId"), 0)
          ), 
        70) as score
      FROM users u
      LEFT JOIN "Answer" a2 ON a2."userId" = u.id
      LEFT JOIN "Answer" a1 ON a1."questionId" = a2."questionId" AND a1."userId" = ${userId}
      WHERE u.id != ${userId}
        AND u.role = 'USER'
        AND u.suspended = false
        AND u.discoverable = true
        AND EXISTS (SELECT 1 FROM "Profile" p WHERE p."userId" = u.id AND p.completed = true)
        AND u.id NOT IN (
          SELECT "blockedId" FROM "Block" WHERE "blockerId" = ${userId}
          UNION
          SELECT "blockerId" FROM "Block" WHERE "blockedId" = ${userId}
          UNION
          SELECT "toId" FROM "Swipe" WHERE "fromId" = ${userId}
        )
      GROUP BY u.id
      ORDER BY score DESC, u.id ASC
      LIMIT 30 OFFSET 0
    `;
    console.log("Raw users page 1 count:", rawUsers.length);
    console.log("Page 1 first IDs:", rawUsers.map(r => r.id).slice(0, 3));

    const rawUsers2 = await prisma.$queryRaw<Array<{id: string, score: number}>>`
      SELECT u.id,
        COALESCE(
          55 + (40.0 * 
            SUM(CASE WHEN a1.selections = a2.selections THEN 1 ELSE 0 END) 
            / NULLIF(COUNT(a1."questionId"), 0)
          ), 
        70) as score
      FROM users u
      LEFT JOIN "Answer" a2 ON a2."userId" = u.id
      LEFT JOIN "Answer" a1 ON a1."questionId" = a2."questionId" AND a1."userId" = ${userId}
      WHERE u.id != ${userId}
        AND u.role = 'USER'
        AND u.suspended = false
        AND u.discoverable = true
        AND EXISTS (SELECT 1 FROM "Profile" p WHERE p."userId" = u.id AND p.completed = true)
        AND u.id NOT IN (
          SELECT "blockedId" FROM "Block" WHERE "blockerId" = ${userId}
          UNION
          SELECT "blockerId" FROM "Block" WHERE "blockedId" = ${userId}
          UNION
          SELECT "toId" FROM "Swipe" WHERE "fromId" = ${userId}
        )
      GROUP BY u.id
      ORDER BY score DESC, u.id ASC
      LIMIT 30 OFFSET 30
    `;
    console.log("Raw users page 2 count:", rawUsers2.length);
    console.log("Page 2 first IDs:", rawUsers2.map(r => r.id).slice(0, 3));
  } catch(e) {
    console.error("SQL Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
