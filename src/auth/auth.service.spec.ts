import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../config/app-settings.service';
import type { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let prisma: {
    user: Record<string, jest.Mock>;
    passwordReset: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let otp: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let service: AuthService;

  const registration: RegisterDto = {
    displayName: 'Somchai P',
    email: 'b6600001@g.sut.ac.th',
    sutId: 'b6600001',
    password: 'a-good-password',
  };

  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'admin@sut.ac.th';
    delete process.env.ALLOW_DEV_OTP;

    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        // Honours `select` the way Prisma does, so a test can tell the
        // difference between "the service narrowed the selection" and "the
        // mock happened to hand everything back".
        create: jest.fn(
          (args: {
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const row: Record<string, unknown> = {
              id: 'user-1',
              role: 'USER',
              createdAt: new Date(),
              suspended: false,
              ...args.data,
            };
            if (!args.select) return Promise.resolve(row);
            return Promise.resolve(
              Object.fromEntries(
                Object.keys(args.select)
                  .filter((field) => args.select![field])
                  .map((field) => [field, row[field]]),
              ),
            );
          },
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordReset: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    otp = {
      isVerified: jest.fn().mockResolvedValue(true),
      consumeVerification: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue('123456'),
      deliver: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue({ verified: true }),
      echo: jest.fn().mockReturnValue(undefined),
    };

    settings = {
      isEmailDomainAllowed: jest.fn((email: string) =>
        Promise.resolve(
          email.endsWith('@g.sut.ac.th') || email === 'admin@sut.ac.th',
        ),
      ),
      allowedEmailDomains: jest.fn().mockResolvedValue(['g.sut.ac.th']),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({ secret: 'test-secret-value-that-is-long-enough' }),
      otp as unknown as OtpService,
      settings as unknown as AppSettingsService,
    );
  });

  describe('register', () => {
    it('stores the SUT id that the form collects', async () => {
      await service.register(registration);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sutId: 'b6600001' }),
        }),
      );
    });

    it('turns the password into a hash, never storing it as given', async () => {
      await service.register(registration);

      const data = prisma.user.create.mock.calls[0][0].data as {
        passwordHash: string;
      };
      expect(data.passwordHash).not.toBe(registration.password);
      expect(data.passwordHash.startsWith('$2')).toBe(true);
    });

    it('refuses an address outside the allowed domains', async () => {
      await expect(
        service.register({ ...registration, email: 'someone@gmail.com' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('refuses to skip the OTP step', async () => {
      otp.isVerified.mockResolvedValue(false);

      await expect(service.register(registration)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('spends the verification so the same code cannot register twice', async () => {
      await service.register(registration);
      expect(otp.consumeVerification).toHaveBeenCalledWith(registration.email);
    });

    it('rejects an email that is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register(registration)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a student id that is already taken', async () => {
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { email?: string; sutId?: string } }) =>
          Promise.resolve(where.sutId ? { id: 'existing' } : null),
      );

      await expect(service.register(registration)).rejects.toThrow(
        /student ID is already registered/,
      );
    });

    it('makes the configured admin address an ADMIN', async () => {
      await service.register({ ...registration, email: 'admin@sut.ac.th' });

      const data = prisma.user.create.mock.calls[0][0].data as { role: string };
      expect(data.role).toBe('ADMIN');
    });

    it('returns a bearer token and never the password hash', async () => {
      const result = await service.register(registration);

      expect(result.token_type).toBe('Bearer');
      expect(result.access_token).toEqual(expect.any(String));
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });
  });

  describe('login', () => {
    const credentials = {
      email: 'b6600001@g.sut.ac.th',
      password: 'a-good-password',
    };

    it('signs in with the right password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: credentials.email,
        displayName: 'Somchai P',
        role: 'USER',
        suspended: false,
        createdAt: new Date(),
        passwordHash: await hash(credentials.password, 12),
      });

      await expect(service.login(credentials)).resolves.toMatchObject({
        token_type: 'Bearer',
      });
    });

    it('gives the same answer for a wrong password as for an unknown account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: await hash('something-else', 12),
        suspended: false,
      });
      const wrongPassword = service
        .login(credentials)
        .catch((e: Error) => e.message);

      prisma.user.findUnique.mockResolvedValue(null);
      const noAccount = service
        .login(credentials)
        .catch((e: Error) => e.message);

      expect(await wrongPassword).toBe(await noAccount);
    });

    it('refuses a suspended account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        suspended: true,
        passwordHash: await hash(credentials.password, 12),
      });

      await expect(service.login(credentials)).rejects.toThrow(/suspended/);
    });

    it('will not sign in a Google-only account with a password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: null,
        suspended: false,
      });

      await expect(service.login(credentials)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('promotes the configured admin address on sign-in', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@sut.ac.th',
        displayName: 'Admin',
        role: 'USER',
        suspended: false,
        createdAt: new Date(),
        passwordHash: await hash(credentials.password, 12),
      });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'admin@sut.ac.th',
        displayName: 'Admin',
        role: 'ADMIN',
        createdAt: new Date(),
      });

      const result = await service.login({
        ...credentials,
        email: 'admin@sut.ac.th',
      });
      expect(result.user.role).toBe('ADMIN');
    });
  });

  describe('checkEmail', () => {
    it('reports whether the address is taken and whether its domain is allowed', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.checkEmail('B6600001@G.SUT.ac.th')).resolves.toEqual(
        {
          exists: true,
          email: 'b6600001@g.sut.ac.th',
          allowedDomain: true,
        },
      );
    });

    it('flags an address from an unsupported domain', async () => {
      await expect(service.checkEmail('someone@gmail.com')).resolves.toEqual({
        exists: false,
        email: 'someone@gmail.com',
        allowedDomain: false,
      });
    });
  });

  describe('sendOtp', () => {
    it('issues and delivers a code', async () => {
      await expect(
        service.sendOtp('b6600001@g.sut.ac.th'),
      ).resolves.toMatchObject({ success: true });
      expect(otp.deliver).toHaveBeenCalledWith(
        'b6600001@g.sut.ac.th',
        '123456',
      );
    });

    it('does not leak the code in the response by default', async () => {
      const result = await service.sendOtp('b6600001@g.sut.ac.th');
      expect(result.otp).toBeUndefined();
    });

    it('refuses an address outside the allowed domains', async () => {
      await expect(service.sendOtp('someone@gmail.com')).rejects.toThrow(
        ForbiddenException,
      );
      expect(otp.issue).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('answers the same way for an unknown address, so accounts stay private', async () => {
      await expect(
        service.forgotPassword('nobody@g.sut.ac.th'),
      ).resolves.toEqual({ ok: true });
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
    });

    it('stores only a hash of the reset token', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      const result = await service.forgotPassword('b6600001@g.sut.ac.th');
      const stored = prisma.passwordReset.create.mock.calls[0][0].data as {
        tokenHash: string;
      };

      expect(result).toEqual({ ok: true });
      expect(stored.tokenHash).toHaveLength(64);
    });

    it('only echoes the reset token when the dev flag is on', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.forgotPassword('b6600001@g.sut.ac.th'),
      ).resolves.toEqual({ ok: true });

      process.env.ALLOW_DEV_OTP = 'true';
      await expect(
        service.forgotPassword('b6600001@g.sut.ac.th'),
      ).resolves.toMatchObject({ resetToken: expect.any(String) });
    });
  });

  describe('resetPasswordWithOtp', () => {
    it('requires a verified OTP first', async () => {
      otp.isVerified.mockResolvedValue(false);

      await expect(
        service.resetPasswordWithOtp('b6600001@g.sut.ac.th', 'new-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('enforces a minimum password length', async () => {
      await expect(
        service.resetPasswordWithOtp('b6600001@g.sut.ac.th', 'short'),
      ).rejects.toThrow(/at least 8 characters/);
    });

    it('sets the new password and spends the verification', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.resetPasswordWithOtp('b6600001@g.sut.ac.th', 'new-password'),
      ).resolves.toEqual({ ok: true });
      expect(otp.consumeVerification).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('refuses a token that was already used', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue({
        id: 'reset-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword('a'.repeat(64), 'new-password'),
      ).rejects.toThrow(/invalid or expired/);
    });

    it('refuses an expired token', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue({
        id: 'reset-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword('a'.repeat(64), 'new-password'),
      ).rejects.toThrow(/invalid or expired/);
    });
  });

  describe('googleLogin', () => {
    it('refuses when no client ids are configured', async () => {
      delete process.env.GOOGLE_CLIENT_IDS;

      await expect(
        service.googleLogin({ idToken: 'x'.repeat(30) }),
      ).rejects.toThrow(/not configured/);
    });
  });
});
