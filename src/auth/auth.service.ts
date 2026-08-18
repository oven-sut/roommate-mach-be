import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../config/app-settings.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { OtpService } from './otp.service';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly otp: OtpService,
    private readonly settings: AppSettingsService,
  ) {}

  /** Rejects addresses outside the domains an admin has allowed. */
  private async assertDomainAllowed(email: string) {
    if (await this.settings.isEmailDomainAllowed(email)) return;
    const domains = await this.settings.allowedEmailDomains();
    const list = domains.map((domain) => '@' + domain).join(' or ');
    throw new ForbiddenException(`Only ${list} accounts can be used`);
  }

  async register(dto: RegisterDto) {
    await this.assertDomainAllowed(dto.email);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('This email is already registered');
    }

    if (!(await this.otp.isVerified(dto.email))) {
      throw new UnauthorizedException(
        'Email not verified. Please verify your email with the OTP sent to it first.',
      );
    }

    if (dto.sutId) {
      const takenId = await this.prisma.user.findUnique({
        where: { sutId: dto.sutId },
        select: { id: true },
      });
      if (takenId) {
        throw new ConflictException('This student ID is already registered');
      }
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          displayName: dto.displayName,
          email: dto.email,
          sutId: dto.sutId ?? null,
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
          sutId: true,
          role: true,
          createdAt: true,
        },
      });

      await this.otp.consumeVerification(dto.email);
      return this.buildAuthResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = String(
          (error.meta as { target?: string | string[] })?.target ?? '',
        );
        throw new ConflictException(
          target.includes('sutId')
            ? 'This student ID is already registered'
            : 'This email is already registered',
        );
      }
      throw error;
    }
  }

  async checkEmail(email: string) {
    if (!email) return { exists: false, email: '', allowedDomain: false };
    const cleanEmail = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { id: true },
    });
    return {
      exists: Boolean(user),
      email: cleanEmail,
      allowedDomain: await this.settings.isEmailDomainAllowed(cleanEmail),
    };
  }

  async sendOtp(email: string) {
    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!cleanEmail) throw new UnauthorizedException('Email is required');
    await this.assertDomainAllowed(cleanEmail);

    const code = await this.otp.issue(cleanEmail);
    await this.otp.deliver(cleanEmail, code);

    return {
      success: true,
      message: 'OTP sent successfully',
      otp: this.otp.echo(code),
    };
  }

  verifyOtp(email: string, code: string) {
    return this.otp.verify(email, code);
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
      where: { email: email.toLowerCase().trim() },
    });
    // Always the same answer, so this cannot be used to discover accounts.
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
    return process.env.ALLOW_DEV_OTP === 'true'
      ? { ok: true, resetToken: token }
      : { ok: true };
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

  /** Reset path the app uses: send-otp then verify-otp then this. */
  async resetPasswordWithOtp(email: string, password: string) {
    const cleanEmail = email.toLowerCase().trim();
    if (!(await this.otp.isVerified(cleanEmail)))
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
    await this.otp.consumeVerification(cleanEmail);
    return { ok: true };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const audiences = process.env.GOOGLE_CLIENT_IDS?.split(',')
      .map((clientId) => clientId.trim())
      .filter(Boolean);

    if (!audiences?.length) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    let payload: TokenPayload | undefined;
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
    await this.assertDomainAllowed(email);

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
              role:
                email === process.env.ADMIN_EMAIL?.toLowerCase()
                  ? 'ADMIN'
                  : 'USER',
            },
          });

    if (user.suspended)
      throw new UnauthorizedException('This account is suspended');

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
