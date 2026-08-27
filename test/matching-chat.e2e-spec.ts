import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Covers the half of the product the original SCRUM suite never reached:
 * discover, swiping, matching, chat with read receipts, the safety tools and
 * the admin console. Runs against the real database, so it cleans up after
 * itself in `afterAll`.
 */
describe('Matching, chat, safety and admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const stamp = Date.now();
  const emails = {
    owl: `e2e_owl_${stamp}@g.sut.ac.th`,
    lark: `e2e_lark_${stamp}@g.sut.ac.th`,
    third: `e2e_third_${stamp}@g.sut.ac.th`,
  };
  const password = 'Password123!';

  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let conversationId: string;

  /** The shape the app's `toApiAnswers` produces, per persona. */
  const ANSWERS = {
    owl: {
      q1: [['23:00–00:00'], ['08:00–09:00']],
      q2: [['Organized chaos'], ['2/5']],
      q3: [['yes'], ['Weekly'], ['5/month'], ['Close friends']],
      q4: [['Just night'], ['24°'], ['3/8'], ['In room']],
    },
    lark: {
      q1: [['21:00–22:00'], ['06:00–07:00']],
      q2: [['Spotless', 'Dishes same day'], ['5/5']],
      q3: [['no'], ['Never'], ['0/month'], ['Study group']],
      q4: [['Just day'], ['28°'], ['8/8'], ['Library']],
    },
    third: {
      q1: [['23:00–00:00'], ['08:00–09:00']],
      q2: [['Organized chaos'], ['2/5']],
      q3: [['yes'], ['Weekly'], ['5/month'], ['Close friends']],
      q4: [['Just night'], ['24°'], ['3/8'], ['In room']],
    },
  };

  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createStudent(who: keyof typeof emails, year: number) {
    const email = emails[who];
    await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ email })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email, otp: '123456' })
      .expect(200);

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ displayName: `E2E ${who}`, email, password })
      .expect(201);

    tokens[who] = registered.body.access_token;
    ids[who] = registered.body.user.id;

    await request(app.getHttpServer())
      .put('/api/profile')
      .set(auth(who))
      .send({
        age: 20,
        year,
        major: 'Computer Engineering',
        gender: 'Any',
        bio: `${who} profile`,
        roomType: 'Double',
        zone: 'Gate 1',
        budgetMin: 3000,
        budgetMax: 6000,
        completed: true,
      })
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/questionnaire')
      .set(auth(who))
      .send({ answers: ANSWERS[who], completed: true })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await createStudent('owl', 2);
    await createStudent('lark', 3);
    await createStudent('third', 2);
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    await prisma.user
      .deleteMany({ where: { email: { in: Object.values(emails) } } })
      .catch(() => undefined);
    await prisma.emailOtp
      .deleteMany({ where: { email: { in: Object.values(emails) } } })
      .catch(() => undefined);
    await app.close();
  });

  describe('questionnaire', () => {
    it('gives back the answers it stored, so Retake reopens on them', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/questionnaire')
        .set(auth('owl'))
        .expect(200);

      expect(res.body.questions).toHaveLength(4);
      expect(res.body.answers.q1).toEqual(ANSWERS.owl.q1);
      expect(res.body.updatedAt).toEqual(expect.any(String));
    });

    it('marks the profile complete so the student enters the deck', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set(auth('owl'))
        .expect(200);

      expect(res.body.profile.completed).toBe(true);
    });
  });

  describe('discover', () => {
    it('scores each candidate from the answers instead of a flat placeholder', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .set(auth('owl'))
        .expect(200);

      const people = res.body as { id: string; score: number }[];
      const byId = new Map(
        people.map((person) => [person.id, person] as const),
      );

      // `third` answered exactly as `owl` did; `lark` is the opposite.
      expect(byId.get(ids.third)!.score).toBe(100);
      expect(byId.get(ids.lark)!.score).toBeLessThan(50);
    });

    it('returns the breakdown and tags the cards render', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .set(auth('owl'))
        .expect(200);

      const twin = res.body.find(
        (person: { id: string }) => person.id === ids.third,
      );
      expect(twin.breakdown).toEqual({
        sleep: 100,
        cleanliness: 100,
        guests: 100,
        temperature: 100,
      });
      expect(twin.tags[0]).toContain('Night Owl');
    });

    it('applies the minimum-score filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .query({ minScore: 90 })
        .set(auth('owl'))
        .expect(200);

      const ids_ = res.body.map((person: { id: string }) => person.id);
      expect(ids_).toContain(ids.third);
      expect(ids_).not.toContain(ids.lark);
    });

    it('applies the year band relative to the viewer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .query({ yearBand: 'upper' })
        .set(auth('owl'))
        .expect(200);

      const ids_ = res.body.map((person: { id: string }) => person.id);
      expect(ids_).toContain(ids.lark); // year 3 to owl's year 2
      expect(ids_).not.toContain(ids.third); // also year 2
    });

    it('applies the budget overlap filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .query({ budgetMin: 20000, budgetMax: 30000 })
        .set(auth('owl'))
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('rejects a filter value it does not understand', async () => {
      await request(app.getHttpServer())
        .get('/api/discover')
        .query({ yearBand: 'wildcard' })
        .set(auth('owl'))
        .expect(400);
    });
  });

  describe('swiping and matching', () => {
    it('records a one-sided like without matching', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/swipes/${ids.third}`)
        .set(auth('owl'))
        .send({ decision: 'LIKE' })
        .expect(201);

      expect(res.body.matched).toBe(false);
    });

    it('shows the pending like to the person who received it', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/likes')
        .set(auth('third'))
        .expect(200);

      expect(res.body.map((row: { fromId: string }) => row.fromId)).toContain(
        ids.owl,
      );
    });

    it('hides a like once it has been answered', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/swipes/${ids.owl}`)
        .set(auth('third'))
        .send({ decision: 'LIKE' })
        .expect(201);

      expect(res.body.matched).toBe(true);
      conversationId = res.body.conversationId;
      expect(conversationId).toEqual(expect.any(String));

      const likes = await request(app.getHttpServer())
        .get('/api/likes')
        .set(auth('third'))
        .expect(200);
      expect(
        likes.body.map((row: { fromId: string }) => row.fromId),
      ).not.toContain(ids.owl);
    });

    it('puts the conversation id on the match, so Message opens the thread', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/matches')
        .set(auth('owl'))
        .expect(200);

      const match = res.body.find(
        (row: { other: { id: string } }) => row.other.id === ids.third,
      );
      expect(match.conversationId).toBe(conversationId);
    });

    it('notifies both sides of the match', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth('owl'))
        .expect(200);

      expect(
        res.body.some((row: { type: string }) => row.type === 'match'),
      ).toBe(true);
    });

    it('does not show a swiped student again', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/discover')
        .set(auth('owl'))
        .expect(200);

      expect(res.body.map((person: { id: string }) => person.id)).not.toContain(
        ids.third,
      );
    });

    it('refuses a swipe on yourself', async () => {
      await request(app.getHttpServer())
        .post(`/api/swipes/${ids.owl}`)
        .set(auth('owl'))
        .send({ decision: 'LIKE' })
        .expect(400);
    });

    it('rejects a decision that is not LIKE or PASS', async () => {
      await request(app.getHttpServer())
        .post(`/api/swipes/${ids.lark}`)
        .set(auth('owl'))
        .send({ decision: 'MAYBE' })
        .expect(400);
    });
  });

  describe('viewing another profile', () => {
    it('reports the score, match and conversation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${ids.third}`)
        .set(auth('owl'))
        .expect(200);

      expect(res.body.score).toBe(100);
      expect(res.body.conversationId).toBe(conversationId);
      expect(res.body.matchedAt).toEqual(expect.any(String));
    });

    it("never exposes another student's email", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${ids.lark}`)
        .set(auth('owl'))
        .expect(200);

      expect(res.body.email).toBeUndefined();
    });

    it('404s on an id that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/api/users/99999999-9999-4999-8999-999999999999')
        .set(auth('owl'))
        .expect(404);
    });
  });

  describe('chat', () => {
    it('opens the thread for a match, and reuses it when asked again', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/conversations')
        .set(auth('owl'))
        .send({ userId: ids.third })
        .expect(201);

      expect(res.body.id).toBe(conversationId);
    });

    it('refuses to open a thread with someone you have not matched', async () => {
      await request(app.getHttpServer())
        .post('/api/conversations')
        .set(auth('owl'))
        .send({ userId: ids.lark })
        .expect(403);
    });

    it('sends and reads a message', async () => {
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set(auth('third'))
        .send({ text: 'Hello, are you still looking?' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set(auth('owl'))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].text).toBe('Hello, are you still looking?');
      expect(res.body[0].readAt).toBeNull();
    });

    it('rejects an empty message', async () => {
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set(auth('owl'))
        .send({ text: '   ' })
        .expect(400);
    });

    it('counts unread messages in the inbox', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/conversations')
        .set(auth('owl'))
        .expect(200);

      const thread = res.body.find(
        (row: { id: string }) => row.id === conversationId,
      );
      expect(thread.unread).toBe(1);
      expect(thread.other.id).toBe(ids.third);
    });

    it('marks the thread read and clears the count', async () => {
      const read = await request(app.getHttpServer())
        .patch(`/api/conversations/${conversationId}/read`)
        .set(auth('owl'))
        .expect(200);
      expect(read.body.updated).toBe(1);

      const res = await request(app.getHttpServer())
        .get('/api/conversations')
        .set(auth('owl'))
        .expect(200);
      const thread = res.body.find(
        (row: { id: string }) => row.id === conversationId,
      );
      expect(thread.unread).toBe(0);
    });

    it('shows the sender that their message was read', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set(auth('third'))
        .expect(200);

      expect(res.body[0].readAt).toEqual(expect.any(String));
    });

    it('pages through history', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post(`/api/conversations/${conversationId}/messages`)
          .set(auth('owl'))
          .send({ text: `message ${i}` })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .query({ limit: 2 })
        .set(auth('owl'))
        .expect(200);

      expect(res.body).toHaveLength(2);
      // Oldest-first within the page, newest page by default.
      expect(res.body[0].text).toBe('message 1');
      expect(res.body[1].text).toBe('message 2');
    });

    it('keeps a stranger out of the thread', async () => {
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set(auth('lark'))
        .expect(403);
    });
  });

  describe('safety', () => {
    it('blocks, unmatches and hides the conversation in one step', async () => {
      await request(app.getHttpServer())
        .post(`/api/blocks/${ids.third}`)
        .set(auth('owl'))
        .expect(201);

      const matches = await request(app.getHttpServer())
        .get('/api/matches')
        .set(auth('owl'))
        .expect(200);
      expect(
        matches.body.some(
          (row: { other: { id: string } }) => row.other.id === ids.third,
        ),
      ).toBe(false);

      const conversations = await request(app.getHttpServer())
        .get('/api/conversations')
        .set(auth('owl'))
        .expect(200);
      expect(
        conversations.body.some(
          (row: { id: string }) => row.id === conversationId,
        ),
      ).toBe(false);
    });

    it('stops messages in a blocked thread from both directions', async () => {
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set(auth('owl'))
        .send({ text: 'still here?' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set(auth('third'))
        .send({ text: 'hello?' })
        .expect(403);
    });

    it('lists and clears blocks', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/blocks')
        .set(auth('owl'))
        .expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).toContain(
        ids.third,
      );

      await request(app.getHttpServer())
        .delete(`/api/blocks/${ids.third}`)
        .set(auth('owl'))
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/blocks')
        .set(auth('owl'))
        .expect(200);
      expect(after.body).toEqual([]);
    });

    it('refuses to block or report yourself', async () => {
      await request(app.getHttpServer())
        .post(`/api/blocks/${ids.owl}`)
        .set(auth('owl'))
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/reports/${ids.owl}`)
        .set(auth('owl'))
        .send({ reason: 'spam' })
        .expect(400);
    });

    it('requires a reason on a report', async () => {
      await request(app.getHttpServer())
        .post(`/api/reports/${ids.lark}`)
        .set(auth('owl'))
        .send({})
        .expect(400);
    });

    it('does not stack duplicate reports', async () => {
      await request(app.getHttpServer())
        .post(`/api/reports/${ids.lark}`)
        .set(auth('owl'))
        .send({ reason: 'Inappropriate messages' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/reports/${ids.lark}`)
        .set(auth('owl'))
        .send({ reason: 'Inappropriate messages' })
        .expect(201);

      const count = await prisma.report.count({
        where: { reporterId: ids.owl, reportedId: ids.lark },
      });
      expect(count).toBe(1);
    });
  });

  describe('notifications', () => {
    it('marks one as read', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth('owl'))
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/notifications/${list.body[0].id}/read`)
        .set(auth('owl'))
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth('owl'))
        .expect(200);
      expect(
        after.body.find((row: { id: string }) => row.id === list.body[0].id)
          .readAt,
      ).toEqual(expect.any(String));
    });

    it('marks them all read', async () => {
      await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set(auth('owl'))
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth('owl'))
        .expect(200);
      expect(
        res.body.every((row: { readAt: string | null }) => row.readAt),
      ).toBe(true);
    });
  });

  describe('admin', () => {
    let adminToken: string;

    beforeAll(async () => {
      // ADMIN_EMAIL is promoted on login, so an existing account is enough.
      const email = process.env.ADMIN_EMAIL?.toLowerCase();
      if (!email) return;

      await prisma.user.updateMany({
        where: { id: ids.lark },
        data: { role: 'ADMIN' },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emails.lark, password })
        .expect(200);
      adminToken = res.body.access_token;
    });

    const admin = () => ({ Authorization: `Bearer ${adminToken}` });

    it('keeps a regular student out', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/dashboard')
        .set(auth('owl'))
        .expect(403);
    });

    it('reports the dashboard counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/dashboard')
        .set(admin())
        .expect(200);

      expect(res.body).toMatchObject({
        members: expect.any(Number),
        active: expect.any(Number),
        matches: expect.any(Number),
        messages: expect.any(Number),
        reports: expect.any(Number),
      });
    });

    it('reads configuration as one object, the shape the screen edits', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/config')
        .set(admin())
        .expect(200);

      expect(typeof res.body.emailDomains).toBe('string');
      expect(res.body.weights).toMatchObject({
        sleep: expect.any(Number),
        cleanliness: expect.any(Number),
        guests: expect.any(Number),
        temperature: expect.any(Number),
      });
    });

    it('saves configuration back over the same route', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/admin/config')
        .set(admin())
        .send({
          emailDomains: 'g.sut.ac.th, sut.ac.th',
          weights: { sleep: 40, cleanliness: 30, guests: 15, temperature: 15 },
        })
        .expect(200);

      expect(res.body.weights.sleep).toBe(40);

      // Put it back so later runs start from the documented default.
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set(admin())
        .send({
          weights: { sleep: 25, cleanliness: 25, guests: 25, temperature: 25 },
        })
        .expect(200);
    });

    it('rejects an empty domain list', async () => {
      await request(app.getHttpServer())
        .put('/api/admin/config')
        .set(admin())
        .send({ emailDomains: '  ,  ' })
        .expect(400);
    });

    it('suspends and reinstates a student', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${ids.owl}/suspend`)
        .set(admin())
        .send({ suspended: true })
        .expect(200);

      // A suspended account cannot use its token any more.
      await request(app.getHttpServer())
        .get('/api/me')
        .set(auth('owl'))
        .expect(401);

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${ids.owl}/suspend`)
        .set(admin())
        .send({ suspended: false })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/me')
        .set(auth('owl'))
        .expect(200);
    });

    it('verifies a student who never uploaded a document, instead of failing', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${ids.owl}/verify`)
        .set(admin())
        .send({ status: 'VERIFIED' })
        .expect(200);

      expect(res.body.status).toBe('VERIFIED');

      const notifications = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth('owl'))
        .expect(200);
      expect(
        notifications.body.some(
          (row: { title: string }) => row.title === 'You are verified',
        ),
      ).toBe(true);
    });

    it('resolves a report', async () => {
      const reports = await request(app.getHttpServer())
        .get('/api/admin/reports')
        .set(admin())
        .expect(200);

      const mine = reports.body.find(
        (row: { reporterId: string }) => row.reporterId === ids.owl,
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/reports/${mine.id}`)
        .set(admin())
        .send({ status: 'RESOLVED' })
        .expect(200);
      expect(res.body.status).toBe('RESOLVED');
    });
  });
});
