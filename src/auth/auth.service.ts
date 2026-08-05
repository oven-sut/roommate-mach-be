import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('This email is already registered');
    }

    if (!this.isEmailVerified(dto.email)) {
      throw new UnauthorizedException(
        'Email not verified. Please verify your email with the OTP sent to it first.',
      );
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          displayName: dto.displayName,
          email: dto.email,
          passwordHash: await hash(dto.password, 12),
          role:
            dto.email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase()
              ? 'ADMIN'
              : 'USER',
        },
        select: {
          id: true,
          displayName: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      this.verifiedEmails.delete(dto.email.toLowerCase().trim());
      return this.buildAuthResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This email is already registered');
      }
      throw error;
    }
  }

  private otpStore = new Map<string, { code: string; expiresAt: number }>();
  private verifiedEmails = new Map<string, number>();
  private readonly allowDevOtp = process.env.ALLOW_DEV_OTP === 'true';

  private isEmailVerified(email: string): boolean {
    const cleanEmail = email.toLowerCase().trim();
    const expiresAt = this.verifiedEmails.get(cleanEmail);
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
      this.verifiedEmails.delete(cleanEmail);
      return false;
    }
    return true;
  }

  async checkEmail(email: string) {
    if (!email) return { exists: false, email: '' };
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });
    return { exists: Boolean(user), email: email.toLowerCase().trim() };
  }

  async sendOtp(email: string) {
    const cleanEmail = email.toLowerCase().trim();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.otpStore.set(cleanEmail, { code, expiresAt });

    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'onboarding@resend.dev',
            to: cleanEmail,
            subject: 'Roommate Match - Verification OTP',
            html: `<p>Your verification code is: <strong>${code}</strong>. It will expire in 10 minutes.</p>`,
          }),
        });
      } catch (err) {
        console.error('Failed to send email via Resend API', err);
      }
    } else {
      console.log(`[OTP Mock] OTP for ${cleanEmail} is ${code}`);
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      otp: this.allowDevOtp ? code : undefined,
    };
  }

  async verifyOtp(email: string, code: string) {
    const cleanEmail = email.toLowerCase().trim();
    const stored = this.otpStore.get(cleanEmail);
    const isValid =
      (stored && stored.code === code && stored.expiresAt > Date.now()) ||
      (this.allowDevOtp && code === '123456');
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }
    this.otpStore.delete(cleanEmail);
    this.verifiedEmails.set(cleanEmail, Date.now() + 30 * 60 * 1000);
    return { verified: true, email: cleanEmail };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (
      !user?.passwordHash ||
      !(await compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.suspended)
      throw new UnauthorizedException('This account is suspended');

    const authenticatedUser =
      user.email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase() &&
      user.role !== 'ADMIN'
        ? await this.prisma.user.update({
            where: { id: user.id },
            data: { role: 'ADMIN' },
          })
        : user;
    return this.buildAuthResponse({
      id: authenticatedUser.id,
      displayName: authenticatedUser.displayName,
      email: authenticatedUser.email,
      role: authenticatedUser.role,
      createdAt: authenticatedUser.createdAt,
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) return { ok: true };
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    return this.allowDevOtp ? { ok: true, resetToken: token } : { ok: true };
  }

  async resetPassword(token: string, password: string) {
    if (password.length < 8)
      throw new UnauthorizedException('Password must be at least 8 characters');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date())
      throw new UnauthorizedException('Reset token is invalid or expired');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: await hash(password, 12) },
      }),
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  async resetPasswordWithOtp(email: string, password: string) {
    const cleanEmail = email.toLowerCase().trim();
    if (!this.isEmailVerified(cleanEmail))
      throw new UnauthorizedException(
        'Please verify the OTP sent to your email first',
      );
    if (password.length < 8)
      throw new UnauthorizedException('Password must be at least 8 characters');
    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (!user) throw new UnauthorizedException('Invalid or expired OTP code');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(password, 12) },
    });
    this.verifiedEmails.delete(cleanEmail);
    return { ok: true };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const audiences = process.env.GOOGLE_CLIENT_IDS?.split(',')
      .map((clientId) => clientId.trim())
      .filter(Boolean);

    if (!audiences?.length) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: audiences,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();
    if (!email.endsWith('@g.sut.ac.th')) {
      throw new UnauthorizedException('Only SUT student accounts are allowed');
    }

    const existingByGoogleId = await this.prisma.user.findFirst({
      where: { googleId: payload.sub },
    });
    const existingByEmail = existingByGoogleId
      ? null
      : await this.prisma.user.findUnique({ where: { email } });

    const user = existingByGoogleId
      ? existingByGoogleId
      : existingByEmail
        ? await this.prisma.user.update({
            where: { id: existingByEmail.id },
            data: { googleId: payload.sub },
          })
        : await this.prisma.user.create({
            data: {
              googleId: payload.sub,
              email,
              displayName: payload.name?.trim() || email.split('@')[0],
            },
          });

    return this.buildAuthResponse({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  }

  private async buildAuthResponse(user: {
    id: string;
    displayName: string;
    email: string;
    role: string;
    createdAt: Date;
  }) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      user,
    };
  }
}
