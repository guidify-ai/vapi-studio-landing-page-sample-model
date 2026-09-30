import { Injectable, Logger } from '@nestjs/common';
import { PlannerLeadMailService } from '../mail/planner-lead-mail.service';
import { projectWebhookUrl } from '../project/project.config';
import { sampleTransientAssistant } from '../vapi/strategies/assistant-request.strategy';

export type OutboundCallInput = {
  companyName: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  /** TCPA / marketing consent — required true. */
  consent: boolean;
  notes?: string;
};

export type OutboundCallResult = {
  ok: boolean;
  dialed: boolean;
  callId?: string;
  error?: string;
  /** Guest-facing guidance when dial fails (e.g. call the bot inbound). */
  message?: string;
  normalizedPhone?: string;
  /** Human-readable caller ID (from VAPI_PHONE_NUMBER_READABLE). */
  fromNumberReadable?: string;
};

/** Guest-facing tip when outbound cannot start — inbound uses the same assistant. */
export function outboundFailureInboundHint(
  fromNumberReadable?: string,
): string {
  const n = (fromNumberReadable || '').trim();
  if (n) {
    return `We couldn't place the outbound call right now. Call ${n} instead — same sample conversation (inbound).`;
  }
  return `We couldn't place the outbound call right now. Call our Studio number instead — same sample conversation (inbound).`;
}

/**
 * `twilio` (default): imported Twilio number + saved assistant in the main Vapi org.
 * `vapi`: Vapi-native number in a separate org (VAPI_NATIVE_*), inline assistant
 * unless VAPI_NATIVE_ASSISTANT_ID is set. Saved assistants are org-scoped.
 */
export type OutboundMode = 'twilio' | 'vapi';

export function outboundMode(): OutboundMode {
  return process.env.VAPI_OUTBOUND_MODE?.trim().toLowerCase() === 'vapi'
    ? 'vapi'
    : 'twilio';
}

type OutboundDialConfig = {
  mode: OutboundMode;
  apiKey?: string;
  phoneNumberId?: string;
  /** Saved assistant id, or null → send the inline sample assistant. */
  assistantId: string | null;
};

function outboundDialConfig(): OutboundDialConfig {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  if (outboundMode() === 'vapi') {
    return {
      mode: 'vapi',
      apiKey: env('VAPI_NATIVE_API_KEY'),
      phoneNumberId: env('VAPI_NATIVE_PHONE_NUMBER_ID'),
      assistantId: env('VAPI_NATIVE_ASSISTANT_ID') ?? null,
    };
  }
  return {
    mode: 'twilio',
    apiKey: env('VAPI_API_KEY'),
    phoneNumberId: env('VAPI_PHONE_NUMBER_ID'),
    assistantId: env('POC_ASSISTANT_ID') ?? env('VAPI_ASSISTANT_ID') ?? null,
  };
}

/** The Twilio line — the only number wired to this sample for inbound calls. */
export function inboundNumberReadable(): string | undefined {
  return process.env.VAPI_PHONE_NUMBER_READABLE?.trim() || undefined;
}

/** Display string for the number guests will see on caller ID. */
export function outboundFromNumberReadable(): string | undefined {
  const raw =
    outboundMode() === 'vapi'
      ? process.env.VAPI_NATIVE_PHONE_NUMBER_READABLE?.trim()
      : process.env.VAPI_PHONE_NUMBER_READABLE?.trim();
  return raw || undefined;
}


/** US-friendly E.164 normalize; returns null if unusable. */
export function normalizePhoneE164(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\+[1-9]\d{7,14}$/.test(t.replace(/[\s()-]/g, ''))) {
    return t.replace(/[\s()-]/g, '');
  }
  const digits = t.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

type VapiCallSnapshot = {
  id?: string;
  status?: string;
  endedReason?: string;
  endedMessage?: string;
  message?: string;
  error?: string;
};

/**
 * Place a Vapi outbound call that runs the same planner Custom LLM assistant,
 * with LP intake seeded in call metadata for Conversation bootstrap.
 *
 * Success mail only after the call has actually started toward the guest number
 * (not merely after Vapi accepted the create-call HTTP request).
 */
@Injectable()
export class OutboundCallService {
  private readonly log = new Logger(OutboundCallService.name);

  constructor(private readonly leadMail: PlannerLeadMailService) {}

  async requestCall(input: OutboundCallInput): Promise<OutboundCallResult> {
    const fromNumberReadable = outboundFromNumberReadable();
    const companyName = input.companyName.trim();
    const contactName = input.contactName.trim();
    const contactEmail = input.contactEmail.trim();
    if (!companyName || !contactName || !contactEmail) {
      return {
        ok: false,
        dialed: false,
        fromNumberReadable,
        error: 'companyName, contactName, and contactEmail are required',
      };
    }
    if (!input.consent) {
      return {
        ok: false,
        dialed: false,
        fromNumberReadable,
        error: 'Consent to receive a call is required',
      };
    }
    const phone = normalizePhoneE164(input.phone);
    if (!phone) {
      return {
        ok: false,
        dialed: false,
        fromNumberReadable,
        error: 'Enter a valid phone number (E.164 or 10-digit US)',
      };
    }

    const dial = outboundDialConfig();
    const { apiKey, phoneNumberId, assistantId } = dial;
    const configured =
      dial.mode === 'vapi'
        ? Boolean(apiKey && phoneNumberId)
        : Boolean(apiKey && phoneNumberId && assistantId);

    if (!apiKey || !phoneNumberId || !configured) {
      this.log.warn(
        dial.mode === 'vapi'
          ? 'Outbound dial skipped (mode=vapi) — set VAPI_NATIVE_API_KEY and VAPI_NATIVE_PHONE_NUMBER_ID'
          : 'Outbound dial skipped — set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, and POC_ASSISTANT_ID',
      );
      const message = outboundFailureInboundHint(inboundNumberReadable());
      await this.leadMail.notifyOutboundCallFailed({
        companyName,
        contactName,
        contactEmail,
        phone,
        notes: input.notes,
        reason: 'vapi_not_configured',
        inboundHint: message,
      });
      return {
        ok: false,
        dialed: false,
        normalizedPhone: phone,
        fromNumberReadable,
        error: 'vapi_not_configured',
        message,
      };
    }

    const metadata = {
      channel: 'phone',
      outbound: true,
      contactName,
      contactEmail,
      guestCompanyName: companyName,
      companyName,
      consentOutboundCall: true,
    };

    const publicBase = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
    // Inline assistant mirrors the saved outbound assistant's call behavior:
    // speak first on pickup (model-generated), same voice / transcriber.
    const assistant = assistantId
      ? { assistantId }
      : {
          assistant: {
            ...sampleTransientAssistant(publicBase),
            server: { url: projectWebhookUrl(publicBase) },
            firstMessageMode: 'assistant-speaks-first-with-model-generated-message',
            voice: { provider: 'vapi', voiceId: 'Elliot' },
            transcriber: {
              provider: 'deepgram',
              model: 'nova-3',
              language: 'en',
              confidenceThreshold: 0.4,
            },
            endCallMessage: 'Goodbye.',
          },
        };
    this.log.log(
      `Outbound dial mode=${dial.mode} assistant=${assistantId ?? 'inline'} to=${phone}`,
    );

    try {
      const res = await fetch('https://api.vapi.ai/call', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...assistant,
          phoneNumberId,
          customer: {
            number: phone,
            name: contactName,
          },
          metadata,
          assistantOverrides: {
            variableValues: {
              contactName,
              contactEmail,
              guestCompanyName: companyName,
              companyName,
            },
            metadata,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as VapiCallSnapshot;
      if (!res.ok || !body.id) {
        const reason =
          body.message || body.error || `Vapi HTTP ${res.status}`;
        this.log.warn(
          `Vapi outbound create failed ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
        );
        await this.leadMail.notifyOutboundCallFailed({
          companyName,
          contactName,
          contactEmail,
          phone,
          notes: input.notes,
          reason,
          fromNumberReadable,
          inboundHint: outboundFailureInboundHint(inboundNumberReadable()),
        });
        return {
          ok: false,
          dialed: false,
          normalizedPhone: phone,
          fromNumberReadable,
          error: reason,
          message: outboundFailureInboundHint(inboundNumberReadable()),
        };
      }

      const started = await this.waitUntilCallStarted(apiKey, body.id);
      if (!started.ok) {
        this.log.warn(
          `Outbound call ${body.id} did not start to=${phone}: ${started.reason}`,
        );
        await this.leadMail.notifyOutboundCallFailed({
          companyName,
          contactName,
          contactEmail,
          phone,
          notes: input.notes,
          reason: started.reason,
          callId: body.id,
          fromNumberReadable,
          inboundHint: outboundFailureInboundHint(inboundNumberReadable()),
        });
        return {
          ok: false,
          dialed: false,
          callId: body.id,
          normalizedPhone: phone,
          fromNumberReadable,
          error: started.reason,
          message: outboundFailureInboundHint(inboundNumberReadable()),
        };
      }

      this.log.log(
        `Outbound call started id=${body.id} to=${phone} status=${started.status}`,
      );
      await this.leadMail.notifyOutboundCallStarted({
        companyName,
        contactName,
        contactEmail,
        phone,
        notes: input.notes,
        callId: body.id,
      });
      return {
        ok: true,
        dialed: true,
        callId: body.id,
        normalizedPhone: phone,
        fromNumberReadable,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`Vapi outbound error: ${reason}`);
      await this.leadMail.notifyOutboundCallFailed({
        companyName,
        contactName,
        contactEmail,
        phone,
        notes: input.notes,
        reason,
        fromNumberReadable,
        inboundHint: outboundFailureInboundHint(inboundNumberReadable()),
      });
      return {
        ok: false,
        dialed: false,
        normalizedPhone: phone,
        fromNumberReadable,
        error: reason,
        message: outboundFailureInboundHint(inboundNumberReadable()),
      };
    }
  }

  /**
   * Vapi may return 200 + call id while the PSTN leg never starts
   * (e.g. Twilio "Account not allowed to call…"). Poll until ringing /
   * in-progress, or until a call.start.* failure is visible.
   */
  private async waitUntilCallStarted(
    apiKey: string,
    callId: string,
  ): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
    const attempts = 16;
    const delayMs = 500;
    let last: VapiCallSnapshot = { id: callId };

    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      try {
        const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) {
          continue;
        }
        last = (await res.json().catch(() => ({}))) as VapiCallSnapshot;
        const status = String(last.status || '').toLowerCase();
        const endedReason = String(last.endedReason || '');

        if (
          status === 'ringing' ||
          status === 'in-progress' ||
          status === 'forwarding'
        ) {
          return { ok: true, status };
        }

        if (status === 'ended' || endedReason) {
          if (
            endedReason.startsWith('call.start.') ||
            endedReason.includes('error-get-transport')
          ) {
            const detail =
              last.endedMessage || endedReason || 'call failed to start';
            return { ok: false, reason: detail };
          }
          // Ended for another reason after having progressed — treat as started.
          if (endedReason && !endedReason.startsWith('call.start.')) {
            return { ok: true, status: status || 'ended' };
          }
        }

        // queued / unknown — keep polling
      } catch {
        // ignore transient poll errors
      }
    }

    // Still queued after wait — carrier accepted create; count as started.
    const status = String(last.status || 'queued').toLowerCase();
    if (status === 'queued' || status === 'ringing' || status === 'in-progress') {
      return { ok: true, status };
    }
    const detail =
      last.endedMessage ||
      last.endedReason ||
      `call did not start (status=${last.status || 'unknown'})`;
    return { ok: false, reason: detail };
  }
}
