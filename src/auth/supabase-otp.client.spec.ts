import { UnauthorizedException } from '@nestjs/common';
import { SupabaseOtpClient } from './supabase-otp.client';

describe('SupabaseOtpClient', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let client: SupabaseOtpClient;

  const respond = (status: number, body: unknown = {}) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });

  beforeEach(() => {
    delete process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
    client = new SupabaseOtpClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('configured', () => {
    it('is on only when both settings are present', () => {
      expect(client.configured).toBe(true);

      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      expect(new SupabaseOtpClient().configured).toBe(false);

      process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
      delete process.env.SUPABASE_URL;
      expect(new SupabaseOtpClient().configured).toBe(false);
    });

    it('accepts the legacy anon key as well', () => {
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.legacy';

      expect(new SupabaseOtpClient().configured).toBe(true);
    });
  });

  describe('headers', () => {
    it('sends a publishable key only as apikey, never as a bearer token', async () => {
      // The new keys are not JWTs, so presenting one as a bearer token would
      // be handing GoTrue something it cannot parse as a session.
      const fetchMock = respond(200);
      global.fetch = fetchMock;

      await client.send('student@g.sut.ac.th');

      const headers = (
        fetchMock.mock.calls[0][1] as {
          headers: Record<string, string>;
        }
      ).headers;
      expect(headers.apikey).toBe('sb_publishable_test-key');
      expect(headers.Authorization).toBeUndefined();
    });

    it('still sends the legacy anon key as a bearer token', async () => {
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.legacy';
      const fetchMock = respond(200);
      global.fetch = fetchMock;

      await new SupabaseOtpClient().send('student@g.sut.ac.th');

      const headers = (
        fetchMock.mock.calls[0][1] as {
          headers: Record<string, string>;
        }
      ).headers;
      expect(headers.Authorization).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.legacy');
    });
  });

  describe('send', () => {
    it('posts to the OTP endpoint with the project key', async () => {
      const fetchMock = respond(200);
      global.fetch = fetchMock;

      await client.send('student@g.sut.ac.th');

      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      expect(url).toBe('https://project.supabase.co/auth/v1/otp');
      expect(init.headers.apikey).toBe('sb_publishable_test-key');
      expect(JSON.parse(init.body)).toEqual({
        email: 'student@g.sut.ac.th',
        // Registration happens before the address has an account, and Supabase
        // will not mail an address it does not know without this.
        create_user: true,
      });
    });

    it('trims a trailing slash off the project URL', async () => {
      process.env.SUPABASE_URL = 'https://project.supabase.co/';
      const fetchMock = respond(200);
      global.fetch = fetchMock;

      await new SupabaseOtpClient().send('student@g.sut.ac.th');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://project.supabase.co/auth/v1/otp',
      );
    });

    it('points at the dashboard setting when Supabase rate limits the mail', async () => {
      global.fetch = respond(429, {
        msg: 'email rate limit exceeded',
      });

      await expect(client.send('student@g.sut.ac.th')).rejects.toThrow(
        /Rate Limits/,
      );
    });

    it('surfaces the reason Supabase gave for a refusal', async () => {
      global.fetch = respond(400, {
        msg: 'Signups not allowed for otp',
      });

      await expect(client.send('student@g.sut.ac.th')).rejects.toThrow(
        /Signups not allowed for otp/,
      );
    });

    it('still fails usefully when the error body is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(client.send('student@g.sut.ac.th')).rejects.toThrow(/500/);
    });
  });

  describe('verify', () => {
    it('posts the code and reports success', async () => {
      const fetchMock = respond(200, { access_token: 'ignored' });
      global.fetch = fetchMock;

      await expect(
        client.verify('student@g.sut.ac.th', '123456'),
      ).resolves.toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('https://project.supabase.co/auth/v1/verify');
      expect(JSON.parse(init.body)).toEqual({
        type: 'email',
        email: 'student@g.sut.ac.th',
        token: '123456',
      });
    });

    it('reports a wrong code as false rather than throwing', async () => {
      // A bad code is an ordinary outcome; the caller turns it into a 401.
      global.fetch = respond(401, {
        msg: 'Token has expired or is invalid',
      });

      await expect(
        client.verify('student@g.sut.ac.th', '000000'),
      ).resolves.toBe(false);
    });

    it('treats a 403 the same way, which is what Supabase actually returns', async () => {
      // Verified against the live API: a wrong code comes back as
      // 403 {"error_code":"otp_expired"}, not 401.
      global.fetch = respond(403, {
        error_code: 'otp_expired',
        msg: 'Token has expired or is invalid',
      });

      await expect(
        client.verify('student@g.sut.ac.th', '000000'),
      ).resolves.toBe(false);
    });

    it('raises the attempt limit as an auth error', async () => {
      global.fetch = respond(429);

      await expect(
        client.verify('student@g.sut.ac.th', '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when Supabase itself is broken, instead of failing the code', async () => {
      // A 500 must not be reported as "wrong code" - that would tell the
      // student to retype a code that was fine.
      global.fetch = respond(500, { msg: 'internal error' });

      await expect(
        client.verify('student@g.sut.ac.th', '123456'),
      ).rejects.toThrow(/internal error/);
    });
  });
});
