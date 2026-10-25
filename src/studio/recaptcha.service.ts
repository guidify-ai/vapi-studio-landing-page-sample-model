import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export type RecaptchaAction =
  | 'studio_chat_start'
  | 'studio_outbound_call'
  | 'studio_contact';

type SiteVerifyResponse = {
  success?: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
};

/**
 * Google reCAPTCHA v3 verification for landing Studio surfaces.
 * When RECAPTCHA_SECRET_KEY is set, token + min score are required.
 * When unset (local), verification is skipped and a warning is logged once.
 */
@Injectable()
export class RecaptchaService {
  private readonly log = new Logger(RecaptchaService.name);
  private warnedSkip = false;

  get siteKey(): string {
    return (process.env.RECAPTCHA_SITE_KEY || '').trim();
  }

  get secretKey(): string {
    return (process.env.RECAPTCHA_SECRET_KEY || '').trim();
  }

  get minScore(): number {
    const n = Number(process.env.RECAPTCHA_MIN_SCORE || '0.5');
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  }

  /** Public config for the landing page. */
  publicConfig(): { enabled: boolean; siteKey: string | null } {
    const siteKey = this.siteKey || null;
    return {
      enabled: Boolean(this.secretKey && siteKey),
      siteKey,
    };
  }

  async assertHuman(input: {
    token?: string | null;
    action: RecaptchaAction;
    remoteIp?: string | null;
  }): Promise<void> {
    const secret = this.secretKey;
    if (!secret) {
      if (!this.warnedSkip) {
        this.warnedSkip = true;
        this.log.warn(
          'RECAPTCHA_SECRET_KEY unset — Studio chat/call endpoints are open. Set site+secret keys before public traffic.',
        );
      }
      return;
    }

    const token = String(input.token || '').trim();
    if (!token) {
      throw new ForbiddenException({
        error: 'recaptcha_required',
        message: 'reCAPTCHA verification required. Refresh and try again.',
      });
    }

    const params = new URLSearchParams();
    params.set('secret', secret);
    params.set('response', token);
    if (input.remoteIp) params.set('remoteip', input.remoteIp);

    let data: SiteVerifyResponse;
    try {
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      data = (await res.json()) as SiteVerifyResponse;
    } catch (err) {
      this.log.error(`reCAPTCHA siteverify failed: ${String(err)}`);
      throw new ServiceUnavailableException({
        error: 'recaptcha_unavailable',
        message: 'Could not verify reCAPTCHA. Try again in a moment.',
      });
    }

    const score = typeof data.score === 'number' ? data.score : 0;
    const actionOk = !data.action || data.action === input.action;
    const ok =
      data.success === true && actionOk && score >= this.minScore;

    if (!ok) {
      this.log.warn(
        `reCAPTCHA rejected action=${input.action} success=${data.success} score=${score} expectedAction=${input.action} gotAction=${data.action} errors=${(data['error-codes'] || []).join(',')}`,
      );
      throw new ForbiddenException({
        error: 'recaptcha_failed',
        message: 'reCAPTCHA check failed. Refresh the page and try again.',
      });
    }
  }
}
