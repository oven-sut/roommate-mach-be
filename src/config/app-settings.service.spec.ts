import {
  AppSettingsService,
  DEFAULT_MATCH_WEIGHTS,
} from './app-settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AppSettingsService', () => {
  let findUnique: jest.Mock;
  let upsert: jest.Mock;
  let service: AppSettingsService;

  beforeEach(() => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    delete process.env.ADMIN_EMAIL;

    findUnique = jest.fn().mockResolvedValue(null);
    upsert = jest.fn((args: { create: unknown }) =>
      Promise.resolve(args.create),
    );
    service = new AppSettingsService({
      appConfig: { findUnique, upsert },
    } as unknown as PrismaService);
  });

  describe('allowedEmailDomains', () => {
    it('falls back to the SUT domains when nothing is configured', async () => {
      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'g.sut.ac.th',
        'sut.ac.th',
      ]);
    });

    it('reads the environment when the database has no row', async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = '@example.edu, Test.AC.TH';
      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'example.edu',
        'test.ac.th',
      ]);
    });

    it('prefers what an admin stored', async () => {
      findUnique.mockResolvedValue({ value: ['configured.ac.th'] });
      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'configured.ac.th',
      ]);
    });

    it('accepts a comma-separated string as well as a list', async () => {
      findUnique.mockResolvedValue({ value: 'a.ac.th, @b.ac.th' });
      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'a.ac.th',
        'b.ac.th',
      ]);
    });

    it('keeps working when the settings table cannot be read', async () => {
      findUnique.mockRejectedValue(new Error('database is down'));
      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'g.sut.ac.th',
        'sut.ac.th',
      ]);
    });
  });

  describe('isEmailDomainAllowed', () => {
    it('allows an address on a listed domain', async () => {
      await expect(
        service.isEmailDomainAllowed('b6627416@g.sut.ac.th'),
      ).resolves.toBe(true);
    });

    it('rejects an address from anywhere else', async () => {
      await expect(
        service.isEmailDomainAllowed('someone@gmail.com'),
      ).resolves.toBe(false);
    });

    it('does not match a domain that merely ends the same way', async () => {
      await expect(
        service.isEmailDomainAllowed('someone@evilsut.ac.th'),
      ).resolves.toBe(false);
    });

    it('always lets the configured admin account in', async () => {
      process.env.ADMIN_EMAIL = 'Admin@Example.com';
      await expect(
        service.isEmailDomainAllowed('admin@example.com'),
      ).resolves.toBe(true);
    });
  });

  describe('matchWeights', () => {
    it('defaults to an even split', async () => {
      await expect(service.matchWeights()).resolves.toEqual(
        DEFAULT_MATCH_WEIGHTS,
      );
    });

    it('fills the gaps in a partial configuration', async () => {
      findUnique.mockResolvedValue({ value: { sleep: 40 } });
      await expect(service.matchWeights()).resolves.toEqual({
        ...DEFAULT_MATCH_WEIGHTS,
        sleep: 40,
      });
    });

    it('ignores an all-zero configuration that would flatten every score', async () => {
      findUnique.mockResolvedValue({
        value: { sleep: 0, cleanliness: 0, guests: 0, temperature: 0 },
      });
      await expect(service.matchWeights()).resolves.toEqual(
        DEFAULT_MATCH_WEIGHTS,
      );
    });
  });

  describe('caching', () => {
    it('does not hit the database twice for the same key', async () => {
      await service.allowedEmailDomains();
      await service.allowedEmailDomains();
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('re-reads after a write', async () => {
      await service.allowedEmailDomains();
      await service.write('emailDomains', ['new.ac.th']);
      findUnique.mockResolvedValue({ value: ['new.ac.th'] });

      await expect(service.allowedEmailDomains()).resolves.toEqual([
        'new.ac.th',
      ]);
      expect(upsert).toHaveBeenCalled();
    });
  });
});
