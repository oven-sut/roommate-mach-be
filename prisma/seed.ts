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

const FIRST_NAMES_M = [
  'Nut', 'Kan', 'Ton', 'Best', 'Game', 'Pete', 'Boss', 'Film', 'Mark', 'Aek',
  'Time', 'New', 'Bank', 'First', 'Ohm', 'Guy', 'Tar', 'Non', 'Frame', 'Job',
];
const FIRST_NAMES_F = [
  'Ploy', 'Fah', 'Bow', 'Milk', 'Nan', 'Ice', 'Gift', 'Prim', 'Fon', 'Mint',
  'Nim', 'Am', 'Ning', 'Ying', 'Waan', 'Pang', 'Kwan', 'Beam', 'Jane', 'Namtan',
];
const LAST_NAMES = [
  'Chaiyaphum', 'Siriwan', 'Thongchai', 'Suksawat', 'Wongsa', 'Ruangrit',
  'Boonmee', 'Chareonsuk', 'Kittisak', 'Pattana', 'Saelee', 'Wattana',
  'Prasert', 'Rattanakosin', 'Intharawut', 'Sombat', 'Chaiwong', 'Aphaiwong',
  'Detsakul', 'Manorom',
];
const MAJORS = [
  'Computer Engineering', 'Nursing', 'Mechanical Engineering',
  'Information Technology', 'Civil Engineering', 'Biotechnology',
  'Business Administration', 'Environmental Engineering', 'Physical Therapy',
  'Electrical Engineering', 'Food Technology', 'Architecture',
  'Public Health', 'Metallurgical Engineering', 'Agricultural Technology',
];
const ZONES = ['Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'Suranaree Zone', 'Off-campus'];
const ROOM_TYPES = ['Single', 'Double', 'Shared'];
const PROPERTY_TYPES = ['On-campus', 'Off-campus', 'Condo'];
const ROOMMATE_GENDERS = ['Same gender', 'Any'];
const BIOS = [
  'Night-shift coder. Headphones on by 23:00, quiet by default.',
  'Up at six for clinicals. I like a tidy room and an early night.',
  'Easy to live with. Happy to split chores on a schedule.',
  'Gym in the morning, library at night. Low drama, high fives.',
  'Plant parent, coffee addict, always down for a movie night.',
  'Studying hard, sleeping harder. Please knock before entering.',
  'Cooks a lot, cleans as I go. Looking for someone chill.',
  'Gamer by night, still make it to 8am classes somehow.',
  'Love a clean common area. Not a neat freak, just tidy.',
  'Music practice a few evenings a week, otherwise very quiet.',
];
const ANSWER_STYLES = ['owl', 'lark', 'balanced'] as const;

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

const DEMO_STUDENT_COUNT = 40;

const SAMPLE_STUDENTS = Array.from({ length: DEMO_STUDENT_COUNT }, (_, i) => {
  const isMale = i % 2 === 0;
  const first = pick(isMale ? FIRST_NAMES_M : FIRST_NAMES_F, i);
  const last = pick(LAST_NAMES, i + 3);
  const answers = pick([...ANSWER_STYLES], i);
  const n = i + 1;
  return {
    email: `demo.student${n}@g.sut.ac.th`,
    sutId: `b66${String(10000 + n).padStart(5, '0')}`,
    displayName: `${first} ${last}`,
    answers,
    profile: {
      age: 19 + (i % 5),
      year: 1 + (i % 4),
      gender: isMale ? 'Male' : 'Female',
      major: pick(MAJORS, i),
      bio: pick(BIOS, i),
      roomType: pick(ROOM_TYPES, i),
      propertyType: pick(PROPERTY_TYPES, i + 1),
      roommateGender: pick(ROOMMATE_GENDERS, i),
      zone: pick(ZONES, i),
      budgetMin: 2500 + (i % 6) * 500,
      budgetMax: 4500 + (i % 8) * 500,
    },
  };
});

/**
 * Fixed, well-known login for manual testing: demo.login@g.sut.ac.th /
 * password from SEED_DEMO_PASSWORD (default demo-password-123).
 */
SAMPLE_STUDENTS.unshift({
  email: 'demo.login@g.sut.ac.th',
  sutId: 'b6600000',
  displayName: 'Demo Login',
  answers: 'balanced',
  profile: {
    age: 21,
    year: 3,
    gender: 'Male',
    major: 'Computer Engineering',
    bio: 'The account you use to log in and poke around the app.',
    roomType: 'Double',
    propertyType: 'On-campus',
    roommateGender: 'Any',
    zone: 'Gate 1',
    budgetMin: 3000,
    budgetMax: 5500,
  },
});

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
    console.log(
      'Skipping demo users (set SEED_DEMO_USERS=true to create them)',
    );
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
  console.log('Login with: demo.login@g.sut.ac.th / ' + password);
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
