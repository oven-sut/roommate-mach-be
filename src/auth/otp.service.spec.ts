import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OtpService } from './otp.service';
import { SupabaseOtpClient } from './supabase-otp.client';
import { PrismaService } from '../prisma/prisma.service';

type Row = {
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  verifiedUntil: Date | null;
  lastSentAt: Date;
  sendsInWindow: number;
  windowStartedAt: Date;
};

/** An in-memory stand-in for the single-row-per-email `email_otps` table. */
function emailOtpTable() {
  const rows = new Map<string, Row>();

  const apply = (row: Row, data: Record<string, unknown>): Row => {
    const next = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === 'object' &&
        'increment' in (value as Record<string, unknown>)
      ) {
        const current = next[key as keyof Row] as unknown as number;
        (next as Record<string, unknown>)[key] =
          current + (value as { increment: number }).increment;
      } else {
        (next as Record<string, unknown>)[key] = value;
      }
    }
    return next;
  };

  return {
    rows,
    findUnique: jest.fn(({ where }: { where: { email: string } }) =>
      Promise.resolve(rows.get(where.email) ?? null),
    ),
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: { email: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.get(where.email);
        const row = existing
          ? apply(existing, update)
          : ({
              attempts: 0,
              consumedAt: null,
              verifiedUntil: null,
              lastSentAt: new Date(),
              sendsInWindow: 0,
              windowStartedAt: new Date(),
              ...create,
            } as Row);
        rows.set(where.email, row);
        return Promise.resolve(row);
      },
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { email: string };
        data: Record<string, unknown>;
      }) => {
        const existing = rows.get(where.email);
        if (!existing) return Promise.reject(new Error('P2025'));
        const row = apply(existing, data);
        rows.set(where.email, row);
        return Promise.resolve(row);
      },
    ),
  };
}

/** A Supabase client that is switched off, so the local code path is used. */
function supabaseOff() {
  return {
    configured: false,
    send: jest.fn(),
    verify: jest.fn(),
  } as unknown as SupabaseOtpClient;
}

describe('OtpService', () => {
  let table: ReturnType<typeof emailOtpTable>;
  let service: OtpService;
  const EMAIL = 'student@g.sut.ac.th';

  beforeEach(() => {
    delete process.env.ALLOW_DEV_OTP;
    table = emailOtpTable();
    service = new OtpService(
      { emailOtp: table } as unknown as PrismaService,
      supabaseOff(),
    );
  });

  it('stores only a hash of the code, never the code itself', async () => {
    const code = await service.issue(EMAIL);
    const row = table.rows.get(EMAIL)!;

    expect(row.codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('accepts the code it issued and marks the address verified', async () => {
    const code = await service.issue(EMAIL);

    await expect(service.verify(EMAIL, code)).resolves.toEqual({
      verified: true,
      email: EMAIL,
    });
    await expect(service.isVerified(EMAIL)).resolves.toBe(true);
  });

  it('is case- and whitespace-insensitive about the address', async () => {
    const code = await service.issue(EMAIL);
    await expect(
      service.verify('  Student@G.SUT.ac.th ', code),
    ).resolves.toMatchObject({ verified: true });
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await service.issue(EMAIL);

    await expect(service.verify(EMAIL, '000000')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(table.rows.get(EMAIL)!.attempts).toBe(1);
  });

  it('burns the code after too many wrong guesses', async () => {
    const code = await service.issue(EMAIL);
    for (let i = 0; i < 5; i++) {
      await expect(service.verify(EMAIL, '000000')).rejects.toThrow();
    }

    // Even the right code is refused once the budget is spent.
    await expect(service.verify(EMAIL, code)).rejects.toThrow(
      /Too many incorrect attempts/,
    );
  });

  it('rejects an expired code', async () => {
    const code = await service.issue(EMAIL);
    table.rows.get(EMAIL)!.expiresAt = new Date(Date.now() - 1000);

    await expect(service.verify(EMAIL, code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('will not let one code be spent twice', async () => {
    const code = await service.issue(EMAIL);
    await service.verify(EMAIL, code);
    await service.consumeVerification(EMAIL);

    await expect(service.isVerified(EMAIL)).resolves.toBe(false);
    await expect(service.verify(EMAIL, code)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('treats a stale verification window as unverified', async () => {
    const code = await service.issue(EMAIL);
    await service.verify(EMAIL, code);
    table.rows.get(EMAIL)!.verifiedUntil = new Date(Date.now() - 1000);

    await expect(service.isVerified(EMAIL)).resolves.toBe(false);
  });

  it('refuses to resend immediately', async () => {
    await service.issue(EMAIL);
    await expect(service.issue(EMAIL)).rejects.toThrow(BadRequestException);
  });

  it('resends once the cooldown has passed, invalidating the old code', async () => {
    const first = await service.issue(EMAIL);
    table.rows.get(EMAIL)!.lastSentAt = new Date(Date.now() - 60_000);
    const second = await service.issue(EMAIL);

    expect(second).not.toBe(first);
    await expect(service.verify(EMAIL, first)).rejects.toThrow();
    await expect(service.verify(EMAIL, second)).resolves.toMatchObject({
      verified: true,
    });
  });

  it('caps how many codes one address can be sent in an hour', async () => {
    for (let i = 0; i < 5; i++) {
      await service.issue(EMAIL);
      // Step past the 30s cooldown without leaving the hourly window.
      table.rows.get(EMAIL)!.lastSentAt = new Date(Date.now() - 60_000);
    }

    await expect(service.issue(EMAIL)).rejects.toThrow(/Too many codes/);
  });

  it('starts a fresh allowance once the hour is up', async () => {
    for (let i = 0; i < 5; i++) {
      await service.issue(EMAIL);
      table.rows.get(EMAIL)!.lastSentAt = new Date(Date.now() - 60_000);
    }

    const row = table.rows.get(EMAIL)!;
    row.windowStartedAt = new Date(Date.now() - 61 * 60_000);

    await expect(service.issue(EMAIL)).resolves.toMatch(/^\d{6}$/);
    expect(table.rows.get(EMAIL)!.sendsInWindow).toBe(1);
  });

  it('issues a six-digit code', async () => {
    expect(await service.issue(EMAIL)).toMatch(/^\d{6}$/);
  });

  describe('with ALLOW_DEV_OTP off', () => {
    it('does not accept the development code', async () => {
      await service.issue(EMAIL);
      await expect(service.verify(EMAIL, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not echo the code back to the caller', () => {
      expect(service.echo('123456')).toBeUndefined();
    });
  });

  describe('with ALLOW_DEV_OTP on', () => {
    beforeEach(() => {
      process.env.ALLOW_DEV_OTP = 'true';
    });

    it('accepts the fixed development code without one being issued', async () => {
      await expect(service.verify(EMAIL, '123456')).resolves.toMatchObject({
        verified: true,
      });
      await expect(service.isVerified(EMAIL)).resolves.toBe(true);
    });

    it('echoes the code so local testing needs no mailbox', () => {
      expect(service.echo('123456')).toBe('123456');
    });
  });
});

describe('OtpService with Supabase delivering the mail', () => {
  let table: ReturnType<typeof emailOtpTable>;
  let supabase: { configured: boolean; send: jest.Mock; verify: jest.Mock };
  let service: OtpService;
  const EMAIL = 'student@g.sut.ac.th';

  beforeEach(() => {
    delete process.env.ALLOW_DEV_OTP;
    table = emailOtpTable();
    supabase = {
      configured: true,
      send: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue(true),
    };
    service = new OtpService(
      { emailOtp: table } as unknown as PrismaService,
      supabase as unknown as SupabaseOtpClient,
    );
  });

  it('asks Supabase to send and keeps no code of its own', async () => {
    await expect(service.issue(EMAIL)).resolves.toBeNull();

    expect(supabase.send).toHaveBeenCalledWith(EMAIL);
    // Supabase owns the secret; storing a hash here would be a second source
    // of truth that nothing checks.
    expect(table.rows.get(EMAIL)!.codeHash).toBe('');
  });

  it('still counts the send against the per-address window', async () => {
    await service.issue(EMAIL);
    expect(table.rows.get(EMAIL)!.sendsInWindow).toBe(1);

    // The cooldown belongs to this service, not to Supabase.
    await expect(service.issue(EMAIL)).rejects.toThrow(/just sent/);
    expect(supabase.send).toHaveBeenCalledTimes(1);
  });

  it('caps sends per address even though Supabase does the mailing', async () => {
    for (let i = 0; i < 5; i++) {
      await service.issue(EMAIL);
      table.rows.get(EMAIL)!.lastSentAt = new Date(Date.now() - 60_000);
    }

    await expect(service.issue(EMAIL)).rejects.toThrow(/Too many codes/);
    expect(supabase.send).toHaveBeenCalledTimes(5);
  });

  it('marks the address verified when Supabase accepts the code', async () => {
    await service.issue(EMAIL);

    await expect(service.verify(EMAIL, '123456')).resolves.toEqual({
      verified: true,
      email: EMAIL,
    });
    expect(supabase.verify).toHaveBeenCalledWith(EMAIL, '123456');
    await expect(service.isVerified(EMAIL)).resolves.toBe(true);
  });

  it('rejects the code when Supabase rejects it', async () => {
    supabase.verify.mockResolvedValue(false);
    await service.issue(EMAIL);

    await expect(service.verify(EMAIL, '000000')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.isVerified(EMAIL)).resolves.toBe(false);
  });

  it('normalises the address before handing it to Supabase', async () => {
    await service.verify('  Student@G.SUT.ac.th ', '123456');
    expect(supabase.verify).toHaveBeenCalledWith(EMAIL, '123456');
  });

  it('does not send anything itself for a Supabase-issued code', async () => {
    const logSpy = jest.spyOn(
      (service as unknown as { logger: { log: jest.Mock } }).logger,
      'log',
    );

    await service.deliver(EMAIL, null);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('never echoes a code it does not have', () => {
    process.env.ALLOW_DEV_OTP = 'true';
    expect(service.echo(null)).toBeUndefined();
  });

  describe('with ALLOW_DEV_OTP on', () => {
    beforeEach(() => {
      process.env.ALLOW_DEV_OTP = 'true';
    });

    it('still accepts the fixed development code without calling Supabase', async () => {
      await expect(service.verify(EMAIL, '123456')).resolves.toMatchObject({
        verified: true,
      });
      expect(supabase.verify).not.toHaveBeenCalled();
    });
  });
});
