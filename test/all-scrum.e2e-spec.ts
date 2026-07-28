import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Roommate Match - Complete SCRUM-152 to SCRUM-173 E2E Suite', () => {
  let app: INestApplication<App>;
  let userToken: string;
  let userId: string;
  let secondUserToken: string;
  let secondUserId: string;
  let resetToken: string;

  const testEmail1 = `scrum_test_${Date.now()}@g.sut.ac.th`;
  const testEmail2 = `scrum_test_2_${Date.now()}@g.sut.ac.th`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('SCRUM-161 & SCRUM-165: Email Duplicate Check Endpoint (/auth/check-email)', () => {
    it('GET /auth/check-email should report false for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/check-email')
        .query({ email: testEmail1 })
        .expect(200);

      expect(res.body).toEqual({ exists: false, email: testEmail1 });
    });

    it('POST /auth/check-email should report false for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/check-email')
        .send({ email: testEmail1 })
        .expect(200);

      expect(res.body).toEqual({ exists: false, email: testEmail1 });
    });
  });

  describe('SCRUM-159 & SCRUM-165: User Registration (/auth/register)', () => {
    it('should register first user successfully', async () => {
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
    });

    it('should register second user successfully', async () => {
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
    it('POST /auth/send-otp should send OTP', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/send-otp')
        .send({ email: testEmail1 })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });

    it('POST /auth/verify-otp should verify OTP with test code 123456', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testEmail1, otp: '123456' })
        .expect(200);

      expect(res.body).toHaveProperty('verified', true);
    });

    it('POST /auth/verify-email should verify email with test code 123456', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ email: testEmail1, code: '123456' })
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
      const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
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
});
