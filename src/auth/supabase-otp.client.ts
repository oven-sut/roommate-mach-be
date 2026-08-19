import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Sends and checks one-time codes through Supabase Auth.
 *
 * Supabase has no general-purpose transactional email API — mail only leaves it
 * through an Auth flow. So when this backend is configured to use Supabase for
 * OTP, Supabase is what generates the code, emails it with the SMTP settings
 * configured in the dashboard, and checks it again on the way back.
 *
 * Talks to the GoTrue REST API directly rather than pulling in
 * `@supabase/supabase-js`, which would add a sizeable dependency to a
 * serverless bundle for the sake of two endpoints.
 */
@Injectable()
export class SupabaseOtpClient {
  private readonly logger = new Logger(SupabaseOtpClient.name);

  private get url() {
    return process.env.SUPABASE_URL?.replace(/\/$/, '');
  }

  /**
   * The project's public API key.
   *
   * Supabase has two generations of these: the newer `sb_publishable_...`
   * keys, and the legacy `anon` JWT. Either is accepted, so a project on
   * either scheme works without a code change.
   */
  private get publishableKey() {
    return (
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY
    );
  }

  /** True once both settings are present, which is what selects this path. */
  get configured(): boolean {
    return Boolean(this.url && this.publishableKey);
  }

  private headers() {
    // `apikey` is what authenticates the project. The legacy anon key is also
    // a valid bearer token and is sent as one for compatibility; the newer
    // publishable keys are not JWTs, so they are not.
    const key = this.publishableKey as string;
    return {
      apikey: key,
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Asks Supabase to email a code.
   *
   * `create_user` has to be on: at registration the address has no account yet,
   * and Supabase refuses to send to an unknown address otherwise. The row it
   * creates in `auth.users` is a side effect — this application authenticates
   * with its own tokens and never reads it.
   */
  async send(email: string): Promise<void> {
    const response = await fetch(`${this.url}/auth/v1/otp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, create_user: true }),
    });

    if (response.ok) return;

    const detail = await this.describe(response);
    this.logger.error(
      `Supabase refused to send the code to ${email}: ${detail}`,
    );

    // Supabase enforces its own cooldown per address and an hourly cap per
    // project. Both come back as 429, and its message names the wait in
    // seconds, which is more use to the caller than anything we could invent.
    // These must not become a 500: nothing is broken, the caller is early.
    if (response.status === 429) {
      throw new HttpException(
        this.messageOf(detail) ??
          'Too many verification emails just now. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Anything else is a delivery problem on our side of the fence, not
    // something the student did wrong.
    throw new ServiceUnavailableException(
      'Could not send the verification email. Please try again in a moment.',
    );
  }

  /** Checks a submitted code. Returns false when Supabase rejects it. */
  async verify(email: string, token: string): Promise<boolean> {
    const response = await fetch(`${this.url}/auth/v1/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ type: 'email', email, token }),
    });

    if (response.ok) return true;
    // A wrong or expired code is an ordinary outcome, not a fault worth logging
    // at error level.
    if (response.status === 401 || response.status === 403) return false;

    const detail = await this.describe(response);
    if (response.status === 429) {
      throw new HttpException(
        'Too many attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.error(
      `Supabase could not verify the code for ${email}: ${detail}`,
    );
    // Deliberately not reported as a wrong code: telling someone to retype a
    // code that was fine sends them in circles.
    throw new ServiceUnavailableException(
      'Could not check the code right now. Please try again in a moment.',
    );
  }

  /** The human-readable half of a "<status>: <message>" detail string. */
  private messageOf(detail: string): string | null {
    const separator = detail.indexOf(': ');
    return separator === -1 ? null : detail.slice(separator + 2);
  }

  /** Pulls the most useful message out of a GoTrue error response. */
  private async describe(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as {
        msg?: string;
        message?: string;
        error_description?: string;
      };
      const message = body.msg ?? body.message ?? body.error_description;
      return message
        ? `${response.status}: ${message}`
        : String(response.status);
    } catch {
      return String(response.status);
    }
  }
}
