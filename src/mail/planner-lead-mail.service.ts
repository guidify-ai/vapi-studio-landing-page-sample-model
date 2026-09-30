import { Injectable, Logger } from '@nestjs/common';
import type { NodeContext } from '@guidify-ai/vapi-studio';
import type { PlannerSchema } from '../conversation/planner-schema';
import { envSubject } from '../app-env';
import {
  leadMailSubject,
  renderLeadMail,
  type LeadMailOutcome,
} from './lead-mail-format';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type NotifyKind = 'success_lead' | 'quote_request' | 'transfer_human';

/**
 * Wrap-up / hot-lead alerts to HOT_LEAD_TO via Resend.
 * Fires early on first sample (SUCCESS_LEAD), then upgrade on hire / transfer.
 */
@Injectable()
export class PlannerLeadMailService {
  private readonly log = new Logger(PlannerLeadMailService.name);

  private enabled(): boolean {
    const flag = (process.env.RESEND_ENABLED || '').trim().toLowerCase();
    if (flag === 'false' || flag === '0' || flag === 'no' || flag === 'off') {
      return false;
    }
    if (flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on') {
      return true;
    }
    return Boolean(process.env.RESEND_API_KEY?.trim());
  }

  private toAddr(): string {
    return (process.env.HOT_LEAD_TO || '').trim();
  }

  /** Issue reports and unanswered docs questions — the Studio team inbox. */
  private reportAddr(): string {
    return (process.env.ISSUE_REPORT_TO || '').trim() || this.toAddr();
  }

  private fromAddr(): string {
    return (
      process.env.RESEND_FROM?.trim() ||
      'Vapi Studio <onboarding@resend.dev>'
    );
  }

  /** First sample shown — SUCCESS_LEAD while guest is still in chat. */
  async notifySampleReady(
    ctx: NodeContext<PlannerSchema>,
  ): Promise<void> {
    await this.notify(ctx, 'success_lead', {
      why: `${ctx.memory.companyName || 'Lead'} completed discovery + sample (${
        ctx.memory.useCase || 'use case'
      })`,
    });
  }

  /** Help me build it — QUOTE_REQUEST (may re-mail even after SUCCESS_LEAD). */
  async notifyQuoteRequested(
    ctx: NodeContext<PlannerSchema>,
  ): Promise<void> {
    await this.notify(ctx, 'quote_request', {
      why: 'Visitor said Help me build it — commercial hire intent.',
      allowAfterSuccess: true,
    });
  }

  /** Web transfer wrap — TRANSFER_HUMAN. */
  async notifyTransferHuman(
    ctx: NodeContext<PlannerSchema>,
    triggerText?: string,
  ): Promise<void> {
    const trigger = (triggerText || ctx.userText || '').trim();
    await this.notify(ctx, 'transfer_human', {
      why: trigger
        ? `Guest asked for a human. Trigger: “${trigger.slice(0, 200)}”`
        : 'Guest asked for a human. Conversation wrapped; Guidify AI should follow up.',
      closedReason: 'transfer_human',
      allowAfterSuccess: true,
    });
  }

  /** Outbound phone demo — use-case capture (SUCCESS_LEAD). */
  async notifyPhoneDemoLead(
    ctx: NodeContext<PlannerSchema>,
  ): Promise<void> {
    await this.notifyDemoOutcome(ctx, 'sales_lead');
  }

  /** Landing demo outcomes — sales / support / feature (with or without contact). */
  async notifyDemoOutcome(
    ctx: NodeContext<PlannerSchema>,
    kind:
      | 'sales_lead'
      | 'support_request'
      | 'feature_request'
      | 'feature_no_contact',
  ): Promise<void> {
    const mem = ctx.memory;
    const phone = (mem.contactPhone || '').trim();
    const email = (mem.contactEmail || '').trim();
    const prefer = mem.contactPrefer || (phone ? 'call' : email ? 'email' : '');
    const biz = (mem.businessDescription || mem.companyDoes || '').trim();
    const useCase = (mem.useCaseText || '').trim();
    const heard = (mem.discoverySource || mem.heardAbout || '').trim();
    const issue = (mem.supportIssue || '').trim();
    const feature = (mem.featureDescription || '').trim();
    const contactBits =
      (prefer ? ` Prefer: ${prefer}.` : '') +
      (email ? ` Email: ${email}.` : '') +
      (phone ? ` Phone: ${phone}.` : '');

    let why: string;
    if (kind === 'sales_lead') {
      why =
        `Landing demo sales lead. Business: “${biz || 'n/a'}”. Use case: “${useCase || 'n/a'}”.` +
        (heard ? ` Heard about: “${heard}”.` : '') +
        contactBits;
    } else if (kind === 'support_request') {
      const detail = (mem.supportDetail || '').trim();
      why =
        `Landing demo issue — visitor wants the team to get back to them. Issue: “${issue || 'n/a'}”.` +
        (detail ? ` Details: “${detail}”.` : '') +
        contactBits;
    } else if (kind === 'feature_no_contact') {
      why = `Landing demo feature request (no contact). Feature: “${feature || 'n/a'}”.`;
    } else {
      why =
        `Landing demo feature request. Feature: “${feature || 'n/a'}”.` +
        contactBits;
    }

    await this.notify(ctx, 'success_lead', {
      why,
      closedReason: `demo_${kind}`,
      allowAfterSuccess: true,
    });
  }

  /** Landing demo issue report — sent as soon as the issue is collected, once per conversation. */
  async notifyIssueReport(ctx: NodeContext<PlannerSchema>): Promise<void> {
    const mem = ctx.memory;
    if (mem.issueReportSent) return;
    const sent = await this.sendReport({
      subject: `Vapi Studio issue report — ${this.visitorLabel(ctx)}`,
      rows: [
        ['Issue', mem.supportIssue || 'n/a'],
        ['Details', mem.supportDetail || 'n/a'],
        ...this.visitorRows(ctx),
      ],
      logLabel: 'Issue report',
    });
    if (sent) mem.issueReportSent = true;
  }

  /** Docs question the advisor couldn't answer — the team answers by email. */
  async notifyDocsQuestionUnanswered(
    ctx: NodeContext<PlannerSchema>,
    question: string,
  ): Promise<void> {
    await this.sendReport({
      subject: `Vapi Studio docs question — ${this.visitorLabel(ctx)}`,
      rows: [['Question', question], ...this.visitorRows(ctx)],
      logLabel: 'Docs question',
    });
  }

  private visitorLabel(ctx: NodeContext<PlannerSchema>): string {
    return (
      ctx.memory.contactName?.trim() ||
      ctx.conversation.variables.contactName?.trim() ||
      'landing visitor'
    );
  }

  private visitorRows(ctx: NodeContext<PlannerSchema>): Array<[string, string]> {
    const mem = ctx.memory;
    const vars = ctx.conversation.variables;
    const rows: Array<[string, string]> = [
      ['Name', mem.contactName || vars.contactName || 'n/a'],
      ['Email', mem.contactEmail || vars.contactEmail || 'n/a'],
    ];
    if (mem.contactPhone) rows.push(['Phone', mem.contactPhone]);
    rows.push(['Channel', vars.callerChannel || 'n/a']);
    rows.push(['Conversation', String(ctx.conversation.id || 'unknown')]);
    return rows;
  }

  private async sendReport(input: {
    subject: string;
    rows: Array<[string, string]>;
    logLabel: string;
  }): Promise<boolean> {
    if (!this.enabled()) {
      this.log.log(`Resend disabled — skipping ${input.logLabel}`);
      return false;
    }
    const to = this.reportAddr();
    const key = process.env.RESEND_API_KEY?.trim();
    if (!to || !key) {
      this.log.warn(`Resend env missing — skipping ${input.logLabel}`);
      return false;
    }
    const html = `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">${input.rows
      .map(
        ([k, v]) =>
          `<tr><th align="left" valign="top">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`,
      )
      .join('')}</table>`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddr(),
          to: [to],
          subject: envSubject(input.subject),
          html,
        }),
      });
      if (!res.ok) {
        this.log.warn(`Resend error ${res.status} (${input.logLabel})`);
        return false;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      this.log.log(`${input.logLabel} sent id=${data.id || '?'} to=${to}`);
      return true;
    } catch (err) {
      this.log.warn(`Resend failed (${input.logLabel}): ${err}`);
      return false;
    }
  }

  /**
   * Landing “Call me” — success only after Vapi has started dialing the guest number.
   * Outcome QUOTE_REQUEST (commercial call-me intent).
   */
  async notifyOutboundCallStarted(input: {
    companyName: string;
    contactName: string;
    contactEmail: string;
    phone: string;
    notes?: string;
    callId: string;
  }): Promise<void> {
    await this.sendOutboundMail({
      outcome: 'QUOTE_REQUEST',
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      phone: input.phone,
      why: `Outbound call started to ${input.phone} (Vapi call ${input.callId}).${
        input.notes ? ` Notes: ${input.notes.slice(0, 200)}` : ''
      }`,
      closedReason: 'outbound_call_started',
      logLabel: 'Outbound-call started mail',
    });
  }

  /**
   * Landing “Call me” — dial never started (config / Twilio / Vapi create failure).
   * Outcome FAILED_LEAD — not a success quote.
   */
  async notifyOutboundCallFailed(input: {
    companyName: string;
    contactName: string;
    contactEmail: string;
    phone: string;
    notes?: string;
    reason: string;
    callId?: string;
    fromNumberReadable?: string;
    inboundHint?: string;
  }): Promise<void> {
    const from = (input.fromNumberReadable || '').trim();
    const inboundTip =
      (input.inboundHint || '').trim() ||
      (from
        ? `Guest advised to call ${from} inbound (same sample).`
        : 'Guest advised to call the Studio number inbound (same sample).');
    await this.sendOutboundMail({
      outcome: 'FAILED_LEAD',
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      phone: input.phone,
      why: `Outbound call did NOT start to ${input.phone}. ${input.reason.slice(0, 400)}${
        input.callId ? ` (Vapi call ${input.callId})` : ''
      }. ${inboundTip}${input.notes ? ` Notes: ${input.notes.slice(0, 200)}` : ''}`,
      closedReason: 'outbound_call_failed',
      logLabel: 'Outbound-call failed mail',
    });
  }

  private async sendOutboundMail(input: {
    outcome: LeadMailOutcome;
    companyName: string;
    contactName: string;
    contactEmail: string;
    phone: string;
    why: string;
    closedReason: string;
    logLabel: string;
  }): Promise<void> {
    if (!this.enabled()) {
      this.log.log(`Resend disabled — skipping ${input.logLabel}`);
      return;
    }
    const to = this.toAddr();
    const key = process.env.RESEND_API_KEY?.trim();
    if (!to || !key) {
      this.log.warn(`Resend env missing — skipping ${input.logLabel}`);
      return;
    }
    const company = input.companyName.trim() || 'unknown';
    const html = renderLeadMail({
      outcome: input.outcome,
      why: input.why,
      sessionId: `outbound-${Date.now().toString(36)}`,
      contact: {
        name: input.contactName,
        email: input.contactEmail,
        company,
      },
      closedReason: input.closedReason,
    });
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddr(),
          to: [to],
          subject: envSubject(leadMailSubject(input.outcome, company)),
          html: html.replace(
            '</ul>',
            `<li><strong>Phone:</strong> ${escapeHtml(input.phone)}</li></ul>`,
          ),
        }),
      });
      if (!res.ok) {
        this.log.warn(`Resend error ${res.status}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      this.log.log(`${input.logLabel} sent id=${data.id || '?'} to=${to}`);
    } catch (err) {
      this.log.warn(`Resend failed: ${err}`);
    }
  }

  private async notify(
    ctx: NodeContext<PlannerSchema>,
    kind: NotifyKind,
    opts: {
      why: string;
      closedReason?: string;
      allowAfterSuccess?: boolean;
    },
  ): Promise<void> {
    const mem = ctx.memory;
    if (kind === 'success_lead' && mem.leadMailSuccessSent) return;
    if (kind === 'quote_request' && mem.leadMailQuoteSent) return;
    if (kind === 'transfer_human' && mem.leadMailTransferSent) return;
    if (
      kind === 'success_lead' &&
      (mem.leadMailQuoteSent || mem.leadMailTransferSent)
    ) {
      return;
    }

    if (!this.enabled()) {
      this.log.log('Resend disabled — skipping lead mail');
      return;
    }
    const to = this.toAddr();
    const key = process.env.RESEND_API_KEY?.trim();
    if (!to) {
      this.log.warn('HOT_LEAD_TO missing — skipping lead mail');
      return;
    }
    if (!key) {
      this.log.warn('RESEND_API_KEY missing — skipping lead mail');
      return;
    }

    const outcome: LeadMailOutcome =
      kind === 'quote_request'
        ? 'QUOTE_REQUEST'
        : kind === 'transfer_human'
          ? 'TRANSFER_HUMAN'
          : 'SUCCESS_LEAD';

    const company =
      mem.companyName?.trim() ||
      ctx.conversation.variables.guestCompanyName?.trim() ||
      'unknown';
    const sessionId = String(ctx.conversation.id || 'unknown');
    const html = renderLeadMail({
      outcome,
      why: opts.why,
      sessionId,
      contact: {
        name: mem.contactName,
        email: mem.contactEmail,
        company,
      },
      useCase: mem.useCase,
      companyDoes: mem.companyDoes,
      discoveryAnswers: mem.discoveryAnswers,
      samplePreview: mem.designDraft?.sampleConversation,
      closedReason: opts.closedReason,
    });

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddr(),
          to: [to],
          subject: envSubject(leadMailSubject(outcome, company)),
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.log.warn(
          `Resend error ${res.status}: ${body.slice(0, 200)}`,
        );
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      this.log.log(
        `Lead mail sent outcome=${outcome} id=${data.id || '?'} to=${to}`,
      );
      if (kind === 'success_lead') mem.leadMailSuccessSent = true;
      if (kind === 'quote_request') mem.leadMailQuoteSent = true;
      if (kind === 'transfer_human') mem.leadMailTransferSent = true;
      // silence unused allowAfterSuccess (documents intent for callers)
      void opts.allowAfterSuccess;
    } catch (err) {
      this.log.warn(`Resend failed: ${err}`);
    }
  }
}
