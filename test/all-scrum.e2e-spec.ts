import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Roommate Match - Complete SCRUM-152 to SCRUM-173 E2E Suite', () => {
  let app: INestApplication<App>;
  let userToken: string;
  let userId: string;
  let secondUserToken: string;
  let secondUserId: string;
  let resetToken: string;

  const testEmail1 = `scrum_test_${Date.now()}@g.sut.ac.th`;
  const testEmail2 = `scrum_test_2_${Date.now()}@g.sut.ac.th`;
  /** Everything this suite creates, so afterAll can clean up after itself. */
  const createdEmails: string[] = [testEmail1, testEmail2];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the global pipes main.ts applies in bootstrap() - without this, DTO
    // whitelisting (and the T-01 privilege-escalation fix) never actually runs in tests.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30000);

  /**
   * The suite creates real rows, so it removes them again. Without this every
   * run leaves orphaned students behind and later runs get slower and noisier.
   * Deleting the user cascades to profile, answers, swipes, matches and chat.
   */
  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.user
        .deleteMany({ where: { email: { in: createdEmails } } })
        .catch(() => undefined);
      await prisma.emailOtp
        .deleteMany({ where: { email: { in: createdEmails } } })
        .catch(() => undefined);
      await app.close();
    }
  });

  describe('SCRUM-161 & SCRUM-165: Email Duplicate Check Endpoint (/auth/check-email)', () => {
    it('GET /auth/check-email should report false for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/check-email')
        .query({ email: testEmail1 })
        .expect(200);

      expect(res.body).toEqual({
        exists: false,
        email: testEmail1,
        allowedDomain: true,
      });
    });

    it('GET /auth/check-email should flag an address outside the SUT domains', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/check-email')
        .query({ email: 'someone@gmail.com' })
        .expect(200);

      expect(res.body.allowedDomain).toBe(false);
    });

    it('POST /auth/check-email should report false for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/check-email')
        .send({ email: testEmail1 })
        .expect(200);

      expect(res.body).toEqual({
        exists: false,
        email: testEmail1,
        allowedDomain: true,
      });
    });
  });

  describe('SCRUM-159 & SCRUM-165: User Registration (/auth/register)', () => {
    it('should reject registration when email has not completed OTP verification', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          displayName: 'Unverified Student',
          email: testEmail1,
          password: 'Password123!',
        })
        .expect(401);
    });

    async function verifyEmailWithOtp(email: string) {
      await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email, otp: '123456' })
        .expect(200);
    }

    it('should register first user successfully after OTP verification', async () => {
      await verifyEmailWithOtp(testEmail1);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          displayName: 'Test Student 1',
          email: testEmail1,
          password: 'Password123!',
        })
        .expect(201);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.email).toBe(testEmail1);

      userToken = res.body.access_token;
      userId = res.body.user.id;
      expect(userId).toEqual(expect.any(String));
    });

    it('should register second user successfully after OTP verification', async () => {
      await verifyEmailWithOtp(testEmail2);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          displayName: 'Test Student 2',
          email: testEmail2,
          password: 'Password123!',
        })
        .expect(201);

      secondUserToken = res.body.access_token;
      secondUserId = res.body.user.id;
    });

    it('GET /auth/check-email should report true for registered email', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/check-email')
        .query({ email: testEmail1 })
        .expect(200);

      expect(res.body.exists).toBe(true);
    });

    it('should fail registering duplicate email with 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          displayName: 'Duplicate User',
          email: testEmail1,
          password: 'Password123!',
        })
        .expect(409);
    });
  });

  describe('SCRUM-155 & SCRUM-169: User Login & Role Payload (/auth/login)', () => {
    it('should log in existing user and return JWT + role payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail1,
          password: 'Password123!',
        })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body.user.role).toBe('USER');
    });

    it('should reject invalid credentials with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail1,
          password: 'WrongPassword!',
        })
        .expect(401);
    });
  });

  describe('SCRUM-152, SCRUM-158, SCRUM-167: OTP Generation & Verification', () => {
    const otpEmail = `scrum_otp_${Date.now()}@g.sut.ac.th`;
    createdEmails.push(otpEmail);

    it('POST /auth/send-otp should send OTP', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email: otpEmail })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });

    it('POST /auth/send-otp should refuse an immediate resend to the same address', async () => {
      await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email: otpEmail })
        .expect(400);
    });

    it('POST /auth/send-otp should refuse an address outside the SUT domains', async () => {
      await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email: `outsider_${Date.now()}@gmail.com` })
        .expect(403);
    });

    it('POST /auth/verify-otp should reject a wrong code', async () => {
      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: otpEmail, otp: '000000' })
        .expect(401);
    });

    it('POST /auth/verify-otp should verify OTP with test code 123456', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: otpEmail, otp: '123456' })
        .expect(200);

      expect(res.body).toHaveProperty('verified', true);
    });

    it('POST /auth/verify-email should verify email with test code 123456', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ email: otpEmail, code: '123456' })
        .expect(200);

      expect(res.body).toHaveProperty('verified', true);
    });
  });

  describe('SCRUM-162 & SCRUM-172: Forgot Password & Reset Password', () => {
    it('POST /auth/forgot-password should generate reset token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testEmail1 })
        .expect(200);

      expect(res.body.ok).toBe(true);
      if (res.body.resetToken) {
        resetToken = res.body.resetToken;
      }
    });

    it('POST /auth/reset-password should update user password', async () => {
      if (!resetToken) return;

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, password: 'NewPassword123!' })
        .expect(200);

      // Verify login with new password
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail1, password: 'NewPassword123!' })
        .expect(200);
    });
  });

  describe('SCRUM-154, SCRUM-156, SCRUM-160: User Profile GET/PUT', () => {
    it('GET /api/me should return current user info', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.email).toBe(testEmail1);
    });

    it('PATCH /api/me should reject unknown fields like role (privilege escalation regression)', async () => {
      await request(app.getHttpServer())
        .patch('/api/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ role: 'ADMIN' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.role).toBe('USER');
    });

    it('PUT /api/profile should update user profile', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          age: 20,
          major: 'Computer Engineering',
          gender: 'Male',
          bio: 'Looking for a quiet roomie',
          year: 2,
          roomType: 'Single',
          roommateGender: 'Male',
          zone: 'Gate 1',
          budgetMin: 3000,
          budgetMax: 5000,
          completed: true,
        })
        .expect(200);

      expect(res.body.major).toBe('Computer Engineering');
      expect(res.body.completed).toBe(true);
    });

    it('GET /api/users/profile alias should return profile info', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.email).toBe(testEmail1);
    });
  });

  describe('SCRUM-153 & SCRUM-157: Avatar Upload to MinIO (/api/users/avatar)', () => {
    it('POST /api/users/avatar should upload base64 avatar image', async () => {
      const sampleBase64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const res = await request(app.getHttpServer())
        .post('/api/users/avatar')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ avatar: sampleBase64 })
        .expect(201);

      expect(res.body).toHaveProperty('url');
      expect(Array.isArray(res.body.photos)).toBe(true);
    });
  });

  describe('SCRUM-166, SCRUM-168, SCRUM-173: User Search, Block & Unblock', () => {
    it('GET /api/users/search should return list of searchable users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/search')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ q: 'Test Student' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((u: any) => u.id === secondUserId)).toBe(true);
    });

    it('POST /api/users/block should block user', async () => {
      await request(app.getHttpServer())
        .post('/api/users/block')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ userId: secondUserId })
        .expect(201);
    });

    it('GET /api/users/search should mark user as isBlocked: true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/search')
        .set('Authorization', `Bearer ${userToken}`)
        .query({ q: 'Test Student 2' })
        .expect(200);

      const target = res.body.find((u: any) => u.id === secondUserId);
      expect(target).toBeDefined();
      expect(target.isBlocked).toBe(true);
    });

    it('POST /api/users/unblock should unblock user', async () => {
      await request(app.getHttpServer())
        .post('/api/users/unblock')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ userId: secondUserId })
        .expect(201);
    });
  });

  describe('SCRUM-170: Permanent account deletion cascades every related table', () => {
    const testEmail3 = `scrum_test_3_${Date.now()}@g.sut.ac.th`;
    createdEmails.push(testEmail3);
    let thirdUserToken: string;
    let thirdUserId: string;
    let prisma: PrismaService;

    it('creates a user with related rows in every child table', async () => {
      prisma = app.get(PrismaService);

      await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email: testEmail3 })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testEmail3, otp: '123456' })
        .expect(200);
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          displayName: 'Cascade Test User',
          email: testEmail3,
          password: 'Password123!',
        })
        .expect(201);
      thirdUserToken = registerRes.body.access_token;
      thirdUserId = registerRes.body.user.id;

      await request(app.getHttpServer())
        .put('/api/profile')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({
          age: 21,
          major: 'Computer Science',
          gender: 'Male',
          bio: 'cascade delete test',
          year: 1,
          roomType: 'Single',
          roommateGender: 'Male',
          zone: 'Gate 2',
          budgetMin: 2000,
          budgetMax: 4000,
          completed: true,
        })
        .expect(200);

      await request(app.getHttpServer())
        .put('/api/questionnaire')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ answers: { q1: [[0], [1]] }, completed: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/verification')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ documentUrl: 'https://example.com/fake-document.png' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testEmail3 })
        .expect(200);

      // Mutual LIKE creates a Swipe from both sides + Match + Conversation + Notification
      await request(app.getHttpServer())
        .post(`/api/swipes/${secondUserId}`)
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ decision: 'LIKE' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/swipes/${thirdUserId}`)
        .set('Authorization', `Bearer ${secondUserToken}`)
        .send({ decision: 'LIKE' })
        .expect(201);

      const conversationsRes = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .expect(200);
      const conversationId = conversationsRes.body[0].id;

      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ text: 'hello from cascade delete test' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/reports/${secondUserId}`)
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ reason: 'test report for cascade delete' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/blocks/${secondUserId}`)
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .expect(201);

      expect(
        await prisma.profile.findUnique({ where: { userId: thirdUserId } }),
      ).not.toBeNull();
      expect(
        await prisma.answer.count({ where: { userId: thirdUserId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.verification.findUnique({
          where: { userId: thirdUserId },
        }),
      ).not.toBeNull();
      expect(
        await prisma.passwordReset.count({ where: { userId: thirdUserId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.swipe.count({
          where: { OR: [{ fromId: thirdUserId }, { toId: thirdUserId }] },
        }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.match.count({
          where: { OR: [{ userAId: thirdUserId }, { userBId: thirdUserId }] },
        }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.conversation.count({
          where: { OR: [{ userAId: thirdUserId }, { userBId: thirdUserId }] },
        }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.message.count({ where: { senderId: thirdUserId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.notification.count({ where: { userId: thirdUserId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.report.count({ where: { reporterId: thirdUserId } }),
      ).toBeGreaterThan(0);
      expect(
        await prisma.block.count({ where: { blockerId: thirdUserId } }),
      ).toBeGreaterThan(0);
    });

    it('DELETE /api/me removes the user and cascades to every related row', async () => {
      await request(app.getHttpServer())
        .delete('/api/me')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .send({ password: 'Password123!' })
        .expect(200);

      expect(
        await prisma.user.findUnique({ where: { id: thirdUserId } }),
      ).toBeNull();
      expect(
        await prisma.profile.findUnique({ where: { userId: thirdUserId } }),
      ).toBeNull();
      expect(
        await prisma.answer.count({ where: { userId: thirdUserId } }),
      ).toBe(0);
      expect(
        await prisma.verification.findUnique({
          where: { userId: thirdUserId },
        }),
      ).toBeNull();
      expect(
        await prisma.passwordReset.count({ where: { userId: thirdUserId } }),
      ).toBe(0);
      expect(
        await prisma.swipe.count({
          where: { OR: [{ fromId: thirdUserId }, { toId: thirdUserId }] },
        }),
      ).toBe(0);
      expect(
        await prisma.match.count({
          where: { OR: [{ userAId: thirdUserId }, { userBId: thirdUserId }] },
        }),
      ).toBe(0);
      expect(
        await prisma.conversation.count({
          where: { OR: [{ userAId: thirdUserId }, { userBId: thirdUserId }] },
        }),
      ).toBe(0);
      expect(
        await prisma.message.count({ where: { senderId: thirdUserId } }),
      ).toBe(0);
      expect(
        await prisma.notification.count({ where: { userId: thirdUserId } }),
      ).toBe(0);
      expect(
        await prisma.report.count({ where: { reporterId: thirdUserId } }),
      ).toBe(0);
      expect(
        await prisma.block.count({ where: { blockerId: thirdUserId } }),
      ).toBe(0);

      await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${thirdUserToken}`)
        .expect(401);
    });

    it('DELETE /api/me should reject an incorrect password', async () => {
      await request(app.getHttpServer())
        .delete('/api/me')
        .set('Authorization', `Bearer ${secondUserToken}`)
        .send({ password: 'WrongPassword!' })
        .expect(401);
    });
  });
});
