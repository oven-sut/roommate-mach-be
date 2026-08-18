import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Weight each questionnaire category carries in the match score. */
export type MatchWeights = {
  sleep: number;
  cleanliness: number;
  guests: number;
  temperature: number;
};

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  sleep: 25,
  cleanliness: 25,
  guests: 25,
  temperature: 25,
};

const DEFAULT_EMAIL_DOMAINS = ['g.sut.ac.th', 'sut.ac.th'];

/** How long a value read from `AppConfig` is trusted before re-reading it. */
const CACHE_TTL_MS = 30_000;

/**
 * Runtime settings an admin can change from the app, read from the `AppConfig`
 * table and cached briefly so hot paths (every login, every discover request)
 * do not add a database round-trip each time.
 */
@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);
  private cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private prisma: PrismaService) {}

  /** Drops the cache so a write is visible immediately. */
  invalidate(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  private async read<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    let value = fallback;
    try {
      const row = await this.prisma.appConfig.findUnique({ where: { key } });
      if (row?.value != null) value = row.value as T;
    } catch (error) {
      // A settings lookup must never take down the request that needed it.
      this.logger.warn(
        `Falling back to defaults for "${key}": ${String(error)}`,
      );
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async write(key: string, value: unknown) {
    const row = await this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    this.invalidate(key);
    return row;
  }

  /**
   * Domains an account may register from, lower-cased and without the `@`.
   * Configured by an admin, seeded from `ALLOWED_EMAIL_DOMAINS` if set.
   */
  async allowedEmailDomains(): Promise<string[]> {
    const fromEnv = process.env.ALLOWED_EMAIL_DOMAINS?.split(',')
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    const configured = await this.read<unknown>(
      'emailDomains',
      fromEnv?.length ? fromEnv : DEFAULT_EMAIL_DOMAINS,
    );

    const list = Array.isArray(configured)
      ? configured
      : String(configured).split(',');

    const cleaned = list
      .map((domain) => String(domain).trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    return cleaned.length ? cleaned : DEFAULT_EMAIL_DOMAINS;
  }

  /** True when `email` belongs to an allowed domain, or is the admin account. */
  async isEmailDomainAllowed(email: string): Promise<boolean> {
    const clean = email.trim().toLowerCase();
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail && clean === adminEmail) return true;

    const domains = await this.allowedEmailDomains();
    return domains.some((domain) => clean.endsWith(`@${domain}`));
  }

  async matchWeights(): Promise<MatchWeights> {
    const stored = await this.read<Partial<MatchWeights>>('weights', {});
    const merged = { ...DEFAULT_MATCH_WEIGHTS, ...(stored ?? {}) };

    // A weight set that sums to zero would make every score identical.
    const total =
      merged.sleep + merged.cleanliness + merged.guests + merged.temperature;
    return total > 0 ? merged : DEFAULT_MATCH_WEIGHTS;
  }
}
