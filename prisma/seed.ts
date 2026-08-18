/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { QUESTION_DEFINITIONS } from '../src/features/questionnaire.definitions';
import { DEFAULT_MATCH_WEIGHTS } from '../src/config/app-settings.service';

const prisma = new PrismaClient();

/** Answer payloads shaped exactly like the app's `toApiAnswers` output. */
const SAMPLE_ANSWERS: Record<string, Record<string, string[][]>> = {
  owl: {
    q1: [['23:30–01:00'], ['09:00–10:30']],
    q2: [['Organized chaos', 'Laundry piles up'], ['2/5']],
    q3: [['yes'], ['Weekly'], ['6/month'], ['Close friends', 'Partner']],
    q4: [['Just night'], ['23°'], ['3/8'], ['In room']],
  },
  lark: {
    q1: [['21:30–22:30'], ['06:00–07:00']],
    q2: [['Spotless', 'Dishes same day', 'Shoes off inside'], ['5/5']],
    q3: [['no'], ['Monthly'], ['1/month'], ['Study group']],
    q4: [['Anytime'], ['26°'], ['7/8'], ['Library']],
  },
  balanced: {
    q1: [['22:30–23:30'], ['07:00–08:30']],
    q2: [['Dishes same day', 'Weekly deep clean'], ['4/5']],
    q3: [['sometime'], ['Monthly'], ['3/month'], ['Close friends']],
    q4: [['Anytime'], ['25°'], ['5/8'], ['In room']],
  },
};

const SAMPLE_STUDENTS = [
  {
    email: 'demo.owl@g.sut.ac.th',
    sutId: 'b6600001',
    displayName: 'Nut Chaiyaphum',
    answers: 'owl' as const,
    profile: {
      age: 20,
      year: 2,
      gender: 'Male',
      major: 'Computer Engineering',
      bio: 'Night-shift coder. Headphones on by 23:00, quiet by default.',
      roomType: 'Double',
      roommateGender: 'Same gender',
      zone: 'Gate 1',
      budgetMin: 3000,
      budgetMax: 5000,
    },
  },
  {
    email: 'demo.lark@g.sut.ac.th',
    sutId: 'b6600002',
    displayName: 'Ploy Siriwan',
    answers: 'lark' as const,
    profile: {
      age: 21,
      year: 3,
      gender: 'Female',
      major: 'Nursing',
      bio: 'Up at six for clinicals. I like a tidy room and an early night.',
      roomType: 'Single',
      roommateGender: 'Same gender',
      zone: 'Gate 3',
      budgetMin: 3500,
      budgetMax: 6000,
    },
  },
  {
    email: 'demo.balanced@g.sut.ac.th',
    sutId: 'b6600003',
    displayName: 'Kan Thongchai',
    answers: 'balanced' as const,
    profile: {
      age: 20,
      year: 2,
      gender: 'Male',
      major: 'Mechanical Engineering',
      bio: 'Easy to live with. Happy to split chores on a schedule.',
      roomType: 'Double',
      roommateGender: 'Any',
      zone: 'Gate 1',
      budgetMin: 3000,
      budgetMax: 5500,
    },
  },
];

/** Questions and groups the questionnaire hangs off. Safe to re-run. */
async function seedQuestions() {
  for (const question of QUESTION_DEFINITIONS) {
    await prisma.question.upsert({
      where: { id: question.id },
      create: {
        id: question.id,
        key: question.key,
        step: question.step,
        title: question.title,
        sub: question.sub,
        note: question.note,
        groups: {
          create: question.groups.map((group, order) => ({
            label: group.label,
            items: group.items,
            active: group.active,
            order,
          })),
        },
      },
      update: {
        key: question.key,
        step: question.step,
        title: question.title,
        sub: question.sub,
        note: question.note,
      },
    });
  }
  console.log(`Seeded ${QUESTION_DEFINITIONS.length} questions`);
}

async function seedConfig() {
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'g.sut.ac.th,sut.ac.th')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

  await prisma.appConfig.upsert({
    where: { key: 'emailDomains' },
    create: { key: 'emailDomains', value: domains },
    update: {},
  });
  await prisma.appConfig.upsert({
    where: { key: 'weights' },
    create: { key: 'weights', value: DEFAULT_MATCH_WEIGHTS },
    update: {},
  });
  console.log('Seeded app configuration');
}

/**
 * Demo students, so a fresh database has something in the discover deck.
 * Skipped unless SEED_DEMO_USERS is set, since these are real, log-in-able
 * accounts that have no business existing in production.
 */
async function seedDemoUsers() {
  if (process.env.SEED_DEMO_USERS !== 'true') {
    console.log('Skipping demo users (set SEED_DEMO_USERS=true to create them)');
    return;
  }

  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo-password-123';
  const passwordHash = await hash(password, 12);

  for (const student of SAMPLE_STUDENTS) {
    const user = await prisma.user.upsert({
      where: { email: student.email },
      create: {
        email: student.email,
        sutId: student.sutId,
        displayName: student.displayName,
        passwordHash,
      },
      update: { displayName: student.displayName },
    });

    await prisma.profile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...student.profile, completed: true },
      update: { ...student.profile, completed: true },
    });

    const answers = SAMPLE_ANSWERS[student.answers];
    for (const question of QUESTION_DEFINITIONS) {
      await prisma.answer.upsert({
        where: {
          userId_questionId: { userId: user.id, questionId: question.id },
        },
        create: {
          userId: user.id,
          questionId: question.id,
          selections: answers[question.key] ?? [],
        },
        update: { selections: answers[question.key] ?? [] },
      });
    }
  }

  console.log(
    `Seeded ${SAMPLE_STUDENTS.length} demo students (password: ${password})`,
  );
}

/** Promotes ADMIN_EMAIL if that account already exists. */
async function promoteAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;

  const updated = await prisma.user.updateMany({
    where: { email },
    data: { role: 'ADMIN' },
  });
  if (updated.count) console.log(`Promoted ${email} to ADMIN`);
}

async function main() {
  await seedQuestions();
  await seedConfig();
  await seedDemoUsers();
  await promoteAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
