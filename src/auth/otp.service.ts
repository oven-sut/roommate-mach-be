import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Codes are valid for this long after they are sent. */
const OTP_TTL_MS = 10 * 60_000;
/** How long "this email passed OTP" stays true, for register / reset to use. */
const VERIFICATION_TTL_MS = 30 * 60_000;
/** Wrong guesses allowed before the code is burned. */
const MAX_ATTEMPTS = 5;
/** Minimum gap between sends to the same address. */
const RESEND_COOLDOWN_MS = 30_000;
/**
 * Sends allowed per address per hour. This is the real defence against
 * mail-bombing someone: a per-IP limit would punish a whole campus behind one
 * NAT while doing nothing about an attacker who has more than one address.
 */
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60_000;
/** The fixed code accepted when ALLOW_DEV_OTP is on, so tests need no mailbox. */
const DEV_OTP = '123456';

/**
 * Email one-time codes, stored in Postgres rather than in process memory so
 * they survive a restart and work when more than one instance is running.
 * Only the SHA-256 of a code is persisted.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private prisma: PrismaService) {}

  private get devOtpAllowed() {
    return process.env.ALLOW_DEV_OTP === 'true';
  }

  private static normalize(email: string) {
    return email.trim().toLowerCase();
  }

  private static hash(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Issues a code and returns it so the caller can deliver it. The code is
   * never returned to a client unless ALLOW_DEV_OTP is on.
   */
  async issue(email: string): Promise<string> {
    const cleanEmail = OtpService.normalize(email);
    const existing = await this.prisma.emailOtp.findUnique({
      where: { email: cleanEmail },
    });

    const now = new Date();

    if (
      existing &&
      now.getTime() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'A code was just sent. Please wait a moment before asking for another.',
      );
    }

    const windowOpen =
      existing != null &&
      now.getTime() - existing.windowStartedAt.getTime() < SEND_WINDOW_MS;

    if (windowOpen && existing.sendsInWindow >= MAX_SENDS_PER_WINDOW) {
      throw new BadRequestException(
        'Too many codes requested for this email. Please try again later.',
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.prisma.emailOtp.upsert({
      where: { email: cleanEmail },
      create: {
        email: cleanEmail,
        codeHash: OtpService.hash(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        lastSentAt: now,
        sendsInWindow: 1,
        windowStartedAt: now,
      },
      update: {
        codeHash: OtpService.hash(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        consumedAt: null,
        lastSentAt: now,
        sendsInWindow: windowOpen ? { increment: 1 } : 1,
        ...(windowOpen ? {} : { windowStartedAt: now }),
      },
    });

    return code;
  }

  /**
   * Checks a submitted code. On success the address is marked verified for
   * `VERIFICATION_TTL_MS`, which is what register and OTP password reset read.
   */
  async verify(email: string, code: string) {
    const cleanEmail = OtpService.normalize(email);
    const submitted = (code ?? '').trim();

    if (this.devOtpAllowed && submitted === DEV_OTP) {
      await this.markVerified(cleanEmail);
      return { verified: true, email: cleanEmail };
    }

    const record = await this.prisma.emailOtp.findUnique({
      where: { email: cleanEmail },
    });

    const invalid = new UnauthorizedException('Invalid or expired OTP code');
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw invalid;
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }
    if (record.codeHash !== OtpService.hash(submitted)) {
      await this.prisma.emailOtp.update({
        where: { email: cleanEmail },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    await this.markVerified(cleanEmail);
    return { verified: true, email: cleanEmail };
  }

  private async markVerified(email: string) {
    const now = new Date();
    const verifiedUntil = new Date(now.getTime() + VERIFICATION_TTL_MS);
    await this.prisma.emailOtp.upsert({
      where: { email },
      create: {
        email,
        // A dev-OTP verification can land without a code ever being issued.
        codeHash: '',
        expiresAt: now,
        consumedAt: now,
        verifiedUntil,
      },
      update: { consumedAt: now, verifiedUntil },
    });
  }

  /** True when `email` passed an OTP recently enough to still count. */
  async isVerified(email: string): Promise<boolean> {
    const record = await this.prisma.emailOtp.findUnique({
      where: { email: OtpService.normalize(email) },
    });
    return Boolean(record?.verifiedUntil && record.verifiedUntil > new Date());
  }

  /** Spends the verification so one code cannot be reused for two actions. */
  async consumeVerification(email: string) {
    await this.prisma.emailOtp
      .update({
        where: { email: OtpService.normalize(email) },
        data: { verifiedUntil: null, codeHash: '', attempts: 0 },
      })
      .catch(() => undefined);
  }

  /** Sends the code by email, or logs it when no mail provider is configured. */
  async deliver(email: string, code: string) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.log(`[OTP] code for ${email} is ${code}`);
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'onboarding@resend.dev',
          to: email,
          subject: 'Roommate Match - Verification code',
          html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
        }),
      });
      if (!response.ok) {
        this.logger.error(
          `Resend rejected the OTP email for ${email} (${response.status})`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}`, error as Error);
    }
  }

  /** Exposes the code to the client only in development. */
  echo(code: string): string | undefined {
    return this.devOtpAllowed ? code : undefined;
  }
}
