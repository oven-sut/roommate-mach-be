import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

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

  private get anonKey() {
    return process.env.SUPABASE_ANON_KEY;
  }

  /** True once both settings are present, which is what selects this path. */
  get configured(): boolean {
    return Boolean(this.url && this.anonKey);
  }

  private headers() {
    return {
      apikey: this.anonKey as string,
      Authorization: `Bearer ${this.anonKey as string}`,
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

    // Supabase applies its own hourly cap on outgoing auth mail, separate from
    // this API's per-address limit. Say so rather than reporting a generic
    // failure, because the fix is a dashboard setting.
    if (response.status === 429) {
      throw new Error(
        'Supabase is rate limiting verification emails. Raise the limit under Authentication > Rate Limits.',
      );
    }
    throw new Error(`Could not send the verification email (${detail})`);
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
      throw new UnauthorizedException(
        'Too many attempts. Please request a new code.',
      );
    }
    this.logger.error(
      `Supabase could not verify the code for ${email}: ${detail}`,
    );
    throw new Error(`Could not verify the code (${detail})`);
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
