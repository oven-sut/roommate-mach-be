import { PrismaClient, SwipeDecision, MatchStatus } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// Sample Thai First Names
const FIRST_NAMES_M = [
  'ณัฐ', 'กานต์', 'ต้น', 'เบสท์', 'เกม', 'พีท', 'บอส', 'ฟิล์ม', 'มาร์ค', 'เอก',
  'ไทม์', 'นิว', 'แบงค์', 'เฟิร์ส', 'โอม', 'กาย', 'ต้าร์', 'นนท์', 'เฟรม', 'จ๊อบ',
  'ภูมิ', 'วิน', 'ปอนด์', 'กอล์ฟ', 'เต้', 'มิว', 'บิว', 'ไอซ์', 'เจมส์', 'ท็อป',
  'โอ๊ต', 'ตั้ม', 'น็อต', 'แป้ง', 'อาร์ต', 'ปั้น', 'ดิว', 'แม็กซ์', 'กัปตัน', 'มิกซ์'
];

const FIRST_NAMES_F = [
  'พลอย', 'ฟ้า', 'โบว์', 'มิลค์', 'นัน', 'ไอซ์', 'กิ๊ฟ', 'พริม', 'ฝน', 'มิ้นท์',
  'นิ่ม', 'แอ๋ม', 'หนิง', 'หญิง', 'หวาน', 'แป้ง', 'ขวัญ', 'บีม', 'เจน', 'น้ำตาล',
  'แพร', 'อาย', 'แนท', 'เมย์', 'มุก', 'เกรซ', 'หมิว', 'เตย', 'เนย', 'ปาย',
  'วิว', 'ฝาง', 'ชมพู', 'เอิร์น', 'ปอง', 'เชอร์รี่', 'ส้ม', 'กิ๊ก', 'นิว', 'อุ้ม'
];

const LAST_NAMES = [
  'ไชยภูมิ', 'ศิริวรรณ', 'ทองชัย', 'สุขสวัสดิ์', 'วงศา', 'เรืองฤทธิ์',
  'บุญมี', 'เจริญสุข', 'กิตติศักดิ์', 'พัฒนา', 'แซ่ลี้', 'วัฒนา',
  'ประเสริฐ', 'รัตนโกสินทร์', 'อินทรวุฒิ', 'สมบัติ', 'ไชยวงศ์', 'อภัยวงศ์',
  'เดชสกุล', 'มโนรมย์', 'ศิริโชติ', 'วงษ์สุวรรณ', 'พงษ์ไทย', 'ศรีสุข',
  'รัตนมณี', 'จันทรสุข', 'ไพศาล', 'วิเศษสมบัติ', 'คุณานนต์', 'วรเวช'
];

const MAJORS = [
  'วิศวกรรมคอมพิวเตอร์', 'พยาบาลศาสตร์', 'วิศวกรรมเครื่องกล',
  'เทคโนโลยีสารสนเทศ', 'วิศวกรรมโยธา', 'เทคโนโลยีชีวภาพ',
  'การจัดการเทคโนโลยีสารสนเทศ', 'วิศวกรรมสิ่งแวดล้อม', 'กายภาพบำบัด',
  'วิศวกรรมไฟฟ้า', 'เทคโนโลยีอาหาร', 'สถาปัตยกรรมศาสตร์',
  'สาธารณสุขศาสตร์', 'วิศวกรรมโลหการ', 'เทคโนโลยีการเกษตร',
  'แพทยศาสตร์', 'ทันตแพทยศาสตร์', 'วิทยาการคอมพิวเตอร์'
];

const ZONES = ['ประตู 1', 'ประตู 2', 'ประตู 3', 'ประตู 4', 'โซนสุรนิเวศ', 'นอกสถานศึกษา (หลัง ม.)', 'เคหะสุรนารี'];
const ROOM_TYPES = ['ห้องเดี่ยว', 'ห้องคู่ (2 คน)', 'ห้องรวม (3-4 คน)'];
const PROPERTY_TYPES = ['หอพักในมหาวิทยาลัย', 'หอพักนอกมหาวิทยาลัย', 'คอนโดมิเนียม', 'บ้านเช่า'];
const ROOMMATE_GENDERS = ['เพศเดียวกัน', 'เพศใดก็ได้'];

const BIOS = [
  'สายเขียนโค้ดกลางคืน ใส่หูฟังตอน 5 ทุ่ม คุยง่าย สบายๆ ครับ',
  'ตื่น 6 โมงเช้าไปขึ้นวอร์ดพยาบาล ชอบห้องสะอาด เป็นระเบียบ เรียบร้อย',
  'อยู่ง่าย กินง่าย ช่วยหารค่าห้องและค่าของใช้ตรงเวลาเสมอค่ะ',
  'ออกกำลังกายตอนเช้า อ่านหนังสือหอสมุดตอนเย็น สบายๆ ไม่มีดราม่า',
  'ทาสแมว ชอบปลูกต้นไม้ ชอบดูหนัง Netflix ชวนคุยได้เสมอ',
  'ตั้งใจเรียน สดใส ร่าเริง ชอบความสงบตอนอ่านหนังสือสอบ',
  'ชอบทำอาหารทานเอง ทำเสร็จล้างทันที หาเพื่อนร่วมห้องชิลๆ ค่ะ',
  'เล่นเกมตอนดึก แต่ใส่หูฟังตลอด ไม่รบกวนคนอื่นแน่นอนครับ',
  'ชอบพื้นที่ส่วนรวมสะอาด ไม่เนี๊ยบมากแต่ขอระเบียบเรียบร้อย',
  'ซ้อมดนตรีบางเย็น นอกนั้นเงียบสงบ หาเพื่อนหารค่าหอแถวประตู 1 ครับ',
  'เด็กวิศวะกิจกรรมเยอะ นอนดึกแต่ตื่นเช้าได้ หาเพื่อนชิลๆ อยู่ด้วยกัน',
  'ชอบเปิดแอร์เย็นๆ 24-25 องศา ชอบความสงบช่วงสอบ หาเพื่อนช่วยกันเรียน'
];

const AVATAR_URLS_MALE = [
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=600&q=80'
];

const AVATAR_URLS_FEMALE = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80'
];

const QUESTION_ANSWERS_POOL = [
  {
    q1: [['23:30–01:00'], ['09:00–10:30']],
    q2: [['Organized chaos', 'Laundry piles up'], ['2/5']],
    q3: [['yes'], ['Weekly'], ['6/month'], ['Close friends', 'Partner']],
    q4: [['Just night'], ['23°'], ['3/8'], ['In room']],
  },
  {
    q1: [['21:30–22:30'], ['06:00–07:00']],
    q2: [['Spotless', 'Dishes same day', 'Shoes off inside'], ['5/5']],
    q3: [['no'], ['Monthly'], ['1/month'], ['Study group']],
    q4: [['Anytime'], ['26°'], ['7/8'], ['Library']],
  },
  {
    q1: [['22:30–23:30'], ['07:00–08:30']],
    q2: [['Dishes same day', 'Weekly deep clean'], ['4/5']],
    q3: [['sometime'], ['Monthly'], ['3/month'], ['Close friends']],
    q4: [['Anytime'], ['25°'], ['5/8'], ['In room']],
  },
  {
    q1: [['01:00+'], ['10:00+']],
    q2: [['Weekly deep clean'], ['3/5']],
    q3: [['yes'], ['Weekly'], ['4/month'], ['Close friends']],
    q4: [['Just night'], ['24°'], ['4/8'], ['Co-working space']],
  }
];

const CHAT_DIALOGUES = [
  [
    'สวัสดีครับ! เห็นว่าเรา Match กัน 94% เลย',
    'หวัดดีค่ะ! ยินดีที่ได้รู้จักน้า เรียนสาขาอะไรเหรอคะ?',
    'เราเรียนวิศวะคอมฯ ครับ กำลังหาเพื่อนหารหอแถวประตู 1 อยู่พอดี',
    'ดีเลย! เราเรียนไอที กำลังมองหาหอแถวประตู 1 เหมือนกัน มีหอในใจหรือยังคะ?',
    'มีดูไว้ 2-3 ที่ครับ เดี๋ยวเราส่งรูปกับราคาให้ดูในแชทนี้นะ'
  ],
  [
    'หวัดดีครับเพื่อน ชวนคุยเรื่องหอพักครับ',
    'สวัสดีครับ! นายดูหอแถวไหนไว้บ้างเหรอ',
    'เราดูหอนอกฝั่งประตู 4 ไว้ครับ ราคาประมาณ 3,500-4,000 หารสองตกคนละไม่ถึงสองพัน',
    'น่าสนใจมากเลยครับ สภาพห้องเป็นไงบ้าง มีแอร์ไหม?',
    'มีแอร์ เฟอร์นิเจอร์ครบเลยครับ ลองไปดูห้องจริงเสาร์นี้ด้วยกันไหม?'
  ],
  [
    'สวัสดีค่า เห็นตอบแบบสอบถามเรื่องเวลานอนตรงกันเลย',
    'ใช่เลยค่ะ! เรานอนประมาณ 4-5 ทุ่มเหมือนกัน ไม่ชอบเสียงดังดึกๆ',
    'ดีจังเลยค่ะ เราเน้นอ่านหนังสือเงียบๆ ช่วงสอบด้วย',
    'งั้นเราลองมานัดเจอคุยรายละเอียดหารห้องกันดูไหมคะ?'
  ]
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log('🚀 Starting large mock data generation (100+ Students)...');
  const passwordHash = await hash('demo-password-123', 10);
  const questions = await prisma.question.findMany();

  if (questions.length === 0) {
    console.error('❌ No questions found in database. Please run prisma seed first.');
    return;
  }

  const createdUserIds: string[] = [];
  const TOTAL_STUDENTS = 120;

  for (let i = 1; i <= TOTAL_STUDENTS; i++) {
    const isMale = i % 2 === 0;
    const firstName = randomPick(isMale ? FIRST_NAMES_M : FIRST_NAMES_F);
    const lastName = randomPick(LAST_NAMES);
    const displayName = `${firstName} ${lastName}`;
    const email = `student${100 + i}@g.sut.ac.th`;
    const sutId = `b6${6 - (i % 3)}${String(1000 + i).padStart(5, '0')}`;
    const avatar = randomPick(isMale ? AVATAR_URLS_MALE : AVATAR_URLS_FEMALE);

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        sutId,
        displayName,
        passwordHash,
        role: 'USER',
        discoverable: true,
      },
      update: { displayName },
    });

    createdUserIds.push(user.id);

    // Profile
    await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        age: 18 + (i % 6),
        year: 1 + (i % 4),
        gender: isMale ? 'Male' : 'Female',
        major: randomPick(MAJORS),
        bio: randomPick(BIOS),
        roomType: randomPick(ROOM_TYPES),
        propertyType: randomPick(PROPERTY_TYPES),
        roommateGender: randomPick(ROOMMATE_GENDERS),
        zone: randomPick(ZONES),
        budgetMin: 2500 + (i % 5) * 500,
        budgetMax: 4500 + (i % 6) * 500,
        photos: [avatar],
        completed: true,
      },
      update: { completed: true },
    });

    // Verification
    if (i % 3 === 0) {
      await prisma.verification.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          status: 'VERIFIED',
          documentUrl: avatar,
        },
        update: { status: 'VERIFIED' },
      });
    }

    // Answers
    const answerSet = randomPick(QUESTION_ANSWERS_POOL);
    for (const q of questions) {
      const selection = (answerSet as any)[q.key] ?? [['Standard']];
      await prisma.answer.upsert({
        where: { userId_questionId: { userId: user.id, questionId: q.id } },
        create: {
          userId: user.id,
          questionId: q.id,
          selections: selection,
        },
        update: { selections: selection },
      });
    }

    if (i % 20 === 0) {
      console.log(`  ✓ Generated ${i} / ${TOTAL_STUDENTS} students`);
    }
  }

  // Generate Demo Login User
  const demoEmail = 'demo.login@g.sut.ac.th';
  const demoUser = await prisma.user.upsert({
    where: { email: demoEmail },
    create: {
      email: demoEmail,
      sutId: 'b6600000',
      displayName: 'Demo Student (Main User)',
      passwordHash,
      role: 'USER',
      discoverable: true,
    },
    update: {},
  });

  await prisma.profile.upsert({
    where: { userId: demoUser.id },
    create: {
      userId: demoUser.id,
      age: 21,
      year: 3,
      gender: 'Male',
      major: 'วิศวกรรมคอมพิวเตอร์',
      bio: 'บัญชีหลักสำหรับทดลองใช้งานระบบจับคู่เพื่อนร่วมห้องพัก',
      roomType: 'ห้องคู่ (2 คน)',
      propertyType: 'หอพักนอกมหาวิทยาลัย',
      roommateGender: 'เพศใดก็ได้',
      zone: 'ประตู 1',
      budgetMin: 3000,
      budgetMax: 5500,
      photos: [AVATAR_URLS_MALE[0]],
      completed: true,
    },
    update: {},
  });

  console.log('⚡ Generating Swipes, Matches and Chat Conversations...');

  // Create Swipes and Matches for demoUser and randomly among students
  const targets = createdUserIds.slice(0, 30);
  for (let j = 0; j < targets.length; j++) {
    const targetId = targets[j];
    const isLike = j % 4 !== 0;

    await prisma.swipe.upsert({
      where: { fromId_toId: { fromId: demoUser.id, toId: targetId } },
      create: {
        fromId: demoUser.id,
        toId: targetId,
        decision: isLike ? SwipeDecision.LIKE : SwipeDecision.PASS,
      },
      update: {},
    });

    if (isLike && j % 2 === 0) {
      await prisma.swipe.upsert({
        where: { fromId_toId: { fromId: targetId, toId: demoUser.id } },
        create: {
          fromId: targetId,
          toId: demoUser.id,
          decision: SwipeDecision.LIKE,
        },
        update: {},
      });

      await prisma.match.upsert({
        where: { userAId_userBId: { userAId: demoUser.id, userBId: targetId } },
        create: {
          userAId: demoUser.id,
          userBId: targetId,
          score: 85 + (j % 12),
          status: MatchStatus.ACTIVE,
        },
        update: {},
      });

      // Create Conversation
      const conversation = await prisma.conversation.upsert({
        where: { userAId_userBId: { userAId: demoUser.id, userBId: targetId } },
        create: {
          userAId: demoUser.id,
          userBId: targetId,
        },
        update: {},
      });

      // Add Dialogue
      const script = CHAT_DIALOGUES[j % CHAT_DIALOGUES.length];
      for (let m = 0; m < script.length; m++) {
        const isDemoSender = m % 2 === 0;
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: isDemoSender ? demoUser.id : targetId,
            text: script[m],
            readAt: new Date(),
          },
        });
      }
    }
  }

  const finalUserCount = await prisma.user.count();
  const finalProfileCount = await prisma.profile.count();
  const finalMatchCount = await prisma.match.count();
  const finalMessageCount = await prisma.message.count();

  console.log('\n🎉 MOCK DATA GENERATION COMPLETE!');
  console.log(`  👥 Total Users: ${finalUserCount}`);
  console.log(`  🖼️ Total Completed Profiles: ${finalProfileCount}`);
  console.log(`  💖 Total Matches Created: ${finalMatchCount}`);
  console.log(`  💬 Total Chat Messages: ${finalMessageCount}`);
  console.log(`  🔑 Login User: demo.login@g.sut.ac.th / demo-password-123`);
}

main()
  .catch((e) => {
    console.error('❌ Error generating mock data:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
