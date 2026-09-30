/**
 * Landing voice demo — project (or exploring) / docs question / issue report / feature idea.
 * Spec: config/demo-conversation.yml
 */

import { Injectable } from '@nestjs/common';
import {
  AgentNode,
  CodeIntention,
  INTENTION_CASCADE_PHASE,
  INTENTION_RUN_KIND,
  STANDARD_INTENTIONS,
  type IntentionContext,
  type IntentionRunResult,
  type ListenExpectation,
  type NodeContext,
  type NodeResult,
} from '@guidify-ai/vapi-studio';
import {
  PLANNER_INTENTIONS,
  type PlannerSchema,
} from '../../planner-schema';
import { stampAnalyticsTag } from '../../../analytics/stamp-analytics-tag';
import { PLANNER_ANALYTICS_TAGS } from '../../../analytics/planner-funnels';
import { portalBoosts } from '../../lib/portal-boosts';
import { PlannerLeadMailService } from '../../../mail/planner-lead-mail.service';
import { ScenarioAdvisorService } from '../../../advisor/scenario-advisor.service';
import { DocsAdvisorService } from '../../../advisor/docs-advisor.service';
import { DIDNT_QUITE_GET_IT } from '../../lib/reask-prompt';
import {
  callerPhoneFromVars,
  detectEntryIntent,
  docsQuestionFrom,
  extractPhoneDigits,
  extractVolunteeredFacts,
  hasProjectSignal,
  isAnsweringPriorAsk,
  looksLikeOptionalRefusal,
  looksLikeStudioQuestion,
  pickScenario,
  salesFactsAck,
  scenarioOfferAsk,
  shortFact,
  softNo,
  softYes,
  syncLegacyHeardAbout,
} from '../../lib/demo-understanding';

export const GREET_HOOK =
  "Most voice bots just free-chat. This one won't — you talk normally, and I still stay on a clear path. Under a minute.";

/**
 * Light-offer the spoken entry paths — not a blank open question.
 * Issue reports and feature ideas are recognised when volunteered, never offered.
 */
export const GREET_PATH_OFFER =
  'Are you here about a project, a question about Studio or its docs, or just exploring?';

export const GREET_ASK = `${GREET_HOOK} ${GREET_PATH_OFFER}`;

export const CLARIFY_ENTRY =
  'Tell me in a line — a project you have in mind, a question about Studio or its docs, or are you just exploring?';

export const SALES_BUSINESS_ASK =
  'Nice. What kind of business is it? A couple of words is enough.';

export const EXPLORING_BUSINESS_ASK =
  'Let\'s try it on a business. Name one in a couple of words, real or made up — like a pizza shop or a dentist — or say "you pick".';

/** Recovery re-ask after the scenarios were offered. */
export const SALES_USE_CASE_ASK =
  'Which of those should the assistant handle — or is it something else?';

export const SALES_DISCOVERY_ASK =
  'One quick question — how did you hear about Vapi Studio?';

export const SALES_CONSENT_ASK =
  'Would you like someone from the Vapi Studio team to contact you to discuss it further?';

export const SALES_CONSENT_CLARIFY =
  'No pressure — should the Vapi Studio team contact you about this, yes or no?';

export const DOCS_QUESTION_ASK = "Sure — what's your question about Studio?";

export const DOCS_LOOKUP = 'Let me check the Studio docs.';

export const DOCS_MORE_ASK = 'Anything else about Studio?';

export const DOCS_UNAVAILABLE =
  "I couldn't check the docs just now, so I've sent your question to the Studio team.";

export const DOCS_END =
  'Glad to help. The full docs are on GitHub, in the guidify-ai vapi-studio repo. Thanks for trying Vapi Studio!';

/** Docs answers per conversation before wrapping up. */
export const MAX_DOCS_ANSWERS = 5;

export const SUPPORT_ISSUE_ASK = "Sorry about that — what's going wrong?";

export const SUPPORT_DETAIL_ASK =
  'Got it. What were you doing when it happened? An error message or your Studio version helps too.';

export const SUPPORT_CONSENT_ASK =
  "Thanks — I've sent that to the Vapi Studio team. Want them to get back to you about it?";

export const SUPPORT_CONSENT_CLARIFY =
  'Should the Studio team get back to you about this issue — yes or no?';

export const FEATURE_ASK = 'Sure — what would you like Studio to do?';

export const FEATURE_CONSENT_ASK =
  'Want us to contact you if we dig into that idea?';

export const FEATURE_CONSENT_CLARIFY =
  'Should we contact you about the feature — yes or no?';

export const CALLER_PHONE_ASK =
  "Great — can we call you back on the number you're calling from?";

export const REQUEST_PHONE_ASK =
  'What phone number should we call?';

export const REQUEST_PHONE_RETRY =
  "I didn't catch the full number. Could you say it once more?";

export const CONTACT_PREFER_ASK_WITH_EMAIL =
  'We already have your email. Prefer a follow-up by email, or a call?';

export const CONTACT_PREFER_ASK =
  'Prefer we email you, or give you a call?';

export const CONTACT_EMAIL_ASK =
  'What email should we use?';

/** Every spoken turn must end with a CTA (question / clear next action). */
function withCta(ack: string, ask: string): string {
  const a = ack.trim();
  const q = ask.trim();
  if (!a) return q;
  if (!q) return a;
  return `${a} ${q}`;
}

function portalListen(
  extras: ListenExpectation['intentions'],
  resolve?: ListenExpectation['resolveIntention'],
  hints?: string[],
): ListenExpectation {
  return {
    intentions: [
      ...extras,
      { name: STANDARD_INTENTIONS.isGoodbye, boost: 6 },
      ...portalBoosts(),
    ],
    hints,
    resolveIntention: resolve,
  };
}

function applyEntryFacts(ctx: NodeContext<PlannerSchema>): void {
  extractVolunteeredFacts(ctx.userText || '', ctx.memory);
  syncLegacyHeardAbout(ctx.memory);
}

async function setEntryIntent(
  ctx: NodeContext<PlannerSchema>,
  intent: NonNullable<PlannerSchema['memory']['primaryIntent']>,
): Promise<void> {
  ctx.memory.primaryIntent = intent;
  const said = (ctx.userText || '').trim();
  if (said) ctx.memory.entryUtterance = said.slice(0, 400);
  applyEntryFacts(ctx);
  await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.entryIntent, { intent });
}

const ENTRY_ROUTES: Array<{
  intention: string;
  intent: NonNullable<PlannerSchema['memory']['primaryIntent']>;
  nodeId: string;
}> = [
  { intention: PLANNER_INTENTIONS.entrySales, intent: 'sales_or_use_case', nodeId: 'salesEntry' },
  { intention: PLANNER_INTENTIONS.entryExploring, intent: 'exploring', nodeId: 'salesEntry' },
  { intention: PLANNER_INTENTIONS.entryDocs, intent: 'docs_question', nodeId: 'docsAnswer' },
  { intention: PLANNER_INTENTIONS.entrySupport, intent: 'support', nodeId: 'supportEntry' },
  { intention: PLANNER_INTENTIONS.entryFeature, intent: 'feature_request', nodeId: 'featureEntry' },
];

/** Route a detected entry intention; null when the intention isn't an entry route. */
async function routeEntry(ctx: NodeContext<PlannerSchema>): Promise<NodeResult | null> {
  const route = ENTRY_ROUTES.find((r) => r.intention === ctx.intention);
  if (!route) return null;
  await setEntryIntent(ctx, route.intent);
  return ctx.output.continueTo({ nodeId: route.nodeId });
}

function entryIntentionFor(intent: string): string | null {
  switch (intent) {
    case 'sales_or_use_case':
      return PLANNER_INTENTIONS.entrySales;
    case 'exploring':
      return PLANNER_INTENTIONS.entryExploring;
    case 'docs_question':
      return PLANNER_INTENTIONS.entryDocs;
    case 'support':
      return PLANNER_INTENTIONS.entrySupport;
    case 'feature_request':
      return PLANNER_INTENTIONS.entryFeature;
    default:
      return null;
  }
}

function entryListenIntentions(): ListenExpectation['intentions'] {
  return [
    { name: PLANNER_INTENTIONS.entrySales, boost: 22, priority: 12 },
    { name: PLANNER_INTENTIONS.entryDocs, boost: 22, priority: 12 },
    { name: PLANNER_INTENTIONS.entrySupport, boost: 22, priority: 12 },
    { name: PLANNER_INTENTIONS.entryFeature, boost: 20, priority: 11 },
    { name: PLANNER_INTENTIONS.entryExploring, boost: 20, priority: 11 },
  ];
}

// ─── Entry ───────────────────────────────────────────────────────────────────

@Injectable()
export class DemoGreetNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.plannerStarted);
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoStarted);
    const fullName = ctx.memory.contactName?.trim();
    const company = ctx.memory.companyName?.trim();
    const email = ctx.memory.contactEmail?.trim();
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.intakeSeeded, {
      hasName: Boolean(fullName),
      hasEmail: Boolean(email),
      hasCompany: Boolean(company),
      complete: Boolean(fullName && company && email),
    });

    if (ctx.intention === PLANNER_INTENTIONS.entryClarify) {
      return ctx.output.continueTo({ nodeId: 'clarifyEntry' });
    }
    const routed = await routeEntry(ctx);
    if (routed) return routed;

    const name = ctx.memory.contactName?.trim()?.split(/\s+/)[0];
    const hi = name ? `Hi ${name}!` : 'Hi!';
    const open = `${hi} ${GREET_ASK}`;

    return ctx.output.sayAndListen(
      open,
      portalListen(
        [
          ...entryListenIntentions(),
          { name: PLANNER_INTENTIONS.entryClarify, boost: 10, priority: 5 },
        ],
        ({ userText }) => {
          const entry = entryIntentionFor(detectEntryIntent(userText));
          if (entry) return entry;
          if (userText.trim().length < 2) return null;
          return PLANNER_INTENTIONS.entryClarify;
        },
        [
          'Project / use case → entry_sales',
          'Question about Studio or its docs → entry_docs',
          'Something in Studio is broken → entry_support',
          'Feature idea → entry_feature',
          'Just exploring / wanna explore → entry_exploring',
          'Unclear → entry_clarify',
        ],
      ),
    );
  }
}

@Injectable()
export class DemoClarifyEntryNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    // First hop from greet with entry_clarify — ask, do not auto-route to explorer.
    if (
      ctx.intention === PLANNER_INTENTIONS.entryClarify &&
      ctx.visitCount('clarifyEntry') <= 1
    ) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.clarificationRequired);
      return ctx.output.sayAndListen(
        CLARIFY_ENTRY,
        portalListen(entryListenIntentions(), ({ userText }) =>
          clarifyResolve(userText),
        ),
      );
    }

    const routed = await routeEntry(ctx);
    if (routed) return routed;

    // Thin / empty after clarifier → gentle exploring (spec).
    // Substantive text should have resolved to sales via clarifyResolve.
    applyEntryFacts(ctx);
    if (
      ctx.memory.businessDescription ||
      ctx.memory.useCaseText ||
      hasProjectSignal(ctx.userText || '')
    ) {
      await setEntryIntent(ctx, 'sales_or_use_case');
      return ctx.output.continueTo({ nodeId: 'salesEntry' });
    }
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.clarificationRequired);
    await setEntryIntent(ctx, 'exploring');
    return ctx.output.continueTo({ nodeId: 'salesEntry' });
  }
}

function clarifyResolve(userText: string): string | null {
  const entry = entryIntentionFor(detectEntryIntent(userText));
  if (entry) return entry;
  if (/\b(help|question|docs?)\b/i.test(userText)) {
    return PLANNER_INTENTIONS.entryDocs;
  }
  if (/\b(fix|broken|issue|bug)\b/i.test(userText)) {
    return PLANNER_INTENTIONS.entrySupport;
  }
  if (hasProjectSignal(userText) || userText.trim().length >= 8) {
    // Substantive answer after clarify → sales, then extract facts from it.
    return PLANNER_INTENTIONS.entrySales;
  }
  // Still thin after clarifier → exploring (handled by node on next visit)
  return null;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

@Injectable()
export class DemoSalesEntryNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.contactPurpose = 'sales_discussion';
    // Exploring is the same path — only the business ask differs.
    const exploring = ctx.memory.primaryIntent === 'exploring';
    if (!exploring) ctx.memory.primaryIntent = 'sales_or_use_case';
    applyEntryFacts(ctx);
    await stampAnalyticsTag(
      ctx,
      exploring
        ? PLANNER_ANALYTICS_TAGS.explorerPath
        : PLANNER_ANALYTICS_TAGS.salesPath,
    );
    if (!ctx.memory.businessDescription) {
      return ctx.output.continueTo({ nodeId: 'salesBusiness' });
    }
    if (!ctx.memory.useCaseText) {
      return ctx.output.continueTo({ nodeId: 'salesUseCase' });
    }
    return ctx.output.continueTo({ nodeId: 'salesDiscovery' });
  }
}

/**
 * optional_skip is listed on several nodes and routing tries them in id order,
 * so each one only accepts a skip for the question it asked itself.
 */
function acceptsSkip(ctx: NodeContext<PlannerSchema>, nodeId: string): boolean {
  if (ctx.intention !== PLANNER_INTENTIONS.optionalSkip) return true;
  const portal = ctx.runtime.portalState;
  return (
    ctx.runtime.currentNodeId === nodeId ||
    (!!portal.activePortalId && portal.originNodeId === nodeId)
  );
}

@Injectable()
export class DemoSalesBusinessNode extends AgentNode<PlannerSchema> {
  async before(ctx: NodeContext<PlannerSchema>): Promise<boolean> {
    return acceptsSkip(ctx, 'salesBusiness');
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('salesBusiness')) &&
      (ctx.intention === PLANNER_INTENTIONS.salesBusiness ||
        ctx.intention === PLANNER_INTENTIONS.optionalSkip);

    const exploring = ctx.memory.primaryIntent === 'exploring';
    const youPick = /\b(you pick|you choose|surprise me|whatever|anything|don'?t care)\b/i.test(
      ctx.userText || '',
    );
    if (answering && (youPick || (exploring && ctx.intention === PLANNER_INTENTIONS.optionalSkip))) {
      ctx.memory.businessDescription = 'pizza shop';
      ctx.memory.companyDoes = 'pizza shop';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.businessExtracted, { picked: true });
      return ctx.output.continueTo({ nodeId: 'salesUseCase' });
    }
    if (answering && ctx.intention === PLANNER_INTENTIONS.optionalSkip) {
      return ctx.output.continueTo({ nodeId: 'salesUseCase' });
    }
    if (answering && ctx.intention === PLANNER_INTENTIONS.salesBusiness) {
      applyEntryFacts(ctx);
      const raw = (ctx.userText || '').trim().slice(0, 200);
      // Prefer extracted business; only fall back to raw when nothing parsed.
      if (!ctx.memory.businessDescription && raw) {
        ctx.memory.businessDescription = raw;
        ctx.memory.companyDoes = raw;
      }
      if (ctx.memory.businessDescription) {
        await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.businessExtracted);
      }
      if (ctx.memory.useCaseText) {
        await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.useCaseExtracted);
        return ctx.output.continueTo({ nodeId: 'salesDiscovery' });
      }
      return ctx.output.continueTo({ nodeId: 'salesUseCase' });
    }

    const prefix = exploring
      ? ''
      : ctx.memory.useCaseText && !ctx.memory.businessDescription
        ? `${shortFact(ctx.memory.useCaseText)} — got it.`
        : 'Got it — a project.';
    return ctx.output.sayAndListen(
      withCta(prefix, exploring ? EXPLORING_BUSINESS_ASK : SALES_BUSINESS_ASK),
      portalListen(
        [
          { name: PLANNER_INTENTIONS.salesBusiness, boost: 20, priority: 12 },
          { name: PLANNER_INTENTIONS.optionalSkip, boost: 14, priority: 8 },
        ],
        ({ userText }) => {
          if (looksLikeOptionalRefusal(userText)) {
            return PLANNER_INTENTIONS.optionalSkip;
          }
          if (userText.trim().length >= 2) {
            return PLANNER_INTENTIONS.salesBusiness;
          }
          return null;
        },
        [
          'Business in a couple of words (or "you pick") → sales_business; refuse → optional_skip',
        ],
      ),
    );
  }
}

/** "Not sure" / "you pick" when choosing a scenario. */
function unsureOfScenario(text: string): boolean {
  return /\b(not sure|no idea|dunno|don'?t know|you pick|you choose|whatever|any( one)?|either)\b/i.test(
    text,
  );
}

function scenarioListen(): ListenExpectation {
  return portalListen(
    [{ name: PLANNER_INTENTIONS.salesUseCase, boost: 20, priority: 12 }],
    ({ userText }) =>
      userText.trim().length >= 2 ? PLANNER_INTENTIONS.salesUseCase : null,
    ['Pick of the offered scenarios ("the second one", "orders", "all") or their own goal → sales_use_case'],
  );
}

/**
 * Suggest 2–3 caller-assistant scenarios for the business (LLM advisor, with
 * offline fallback) and wait for the caller's pick.
 */
@Injectable()
export class DemoSalesUseCaseNode extends AgentNode<PlannerSchema> {
  constructor(private readonly scenarios: ScenarioAdvisorService) {
    super();
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    if (ctx.memory.useCaseText) {
      return ctx.output.continueTo({ nodeId: 'salesDiscovery' });
    }
    const options = ctx.memory.scenarioOptions || [];
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('salesUseCase')) &&
      ctx.intention === PLANNER_INTENTIONS.salesUseCase &&
      options.length > 0;

    if (answering) {
      const said = (ctx.userText || '').trim();
      const match = pickScenario(said, options);
      const picked =
        match?.own && unsureOfScenario(said)
          ? { choice: options[0], index: 0 }
          : match;
      if (picked) {
        ctx.memory.useCaseText = picked.choice;
        ctx.memory.companyDoes = ctx.memory.companyDoes || picked.choice;
        await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.useCaseExtracted, {
          scenarioIndex: picked.index,
        });
        return ctx.output.continueTo({ nodeId: 'salesDiscovery' });
      }
      return ctx.output.sayAndListen(SALES_USE_CASE_ASK, scenarioListen());
    }

    const business = ctx.memory.businessDescription || '';
    const offer = options.length ? options : await this.scenarios.suggest(business);
    ctx.memory.scenarioOptions = offer;
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.scenariosOffered, {
      count: offer.length,
    });
    return ctx.output.sayAndListen(scenarioOfferAsk(business, offer), scenarioListen());
  }
}

@Injectable()
export class DemoSalesDiscoveryNode extends AgentNode<PlannerSchema> {
  async before(ctx: NodeContext<PlannerSchema>): Promise<boolean> {
    return acceptsSkip(ctx, 'salesDiscovery');
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    if (ctx.memory.discoverySource) {
      return ctx.output.continueTo({ nodeId: 'salesConsent' });
    }
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('salesDiscovery')) &&
      (ctx.intention === PLANNER_INTENTIONS.salesDiscovery ||
        ctx.intention === PLANNER_INTENTIONS.optionalSkip);

    if (answering) {
      applyEntryFacts(ctx);
      if (
        ctx.intention === PLANNER_INTENTIONS.salesDiscovery &&
        !ctx.memory.discoverySource
      ) {
        const raw = (ctx.userText || '').trim().slice(0, 200);
        if (raw.length >= 2) ctx.memory.discoverySource = raw;
      }
      syncLegacyHeardAbout(ctx.memory);
      if (ctx.memory.discoverySource) {
        await stampAnalyticsTag(
          ctx,
          PLANNER_ANALYTICS_TAGS.discoverySourceExtracted,
        );
      }
      return ctx.output.continueTo({ nodeId: 'salesConsent' });
    }

    const prefix = salesFactsAck(ctx.memory);
    return ctx.output.sayAndListen(
      withCta(prefix, SALES_DISCOVERY_ASK),
      portalListen(
        [
          { name: PLANNER_INTENTIONS.salesDiscovery, boost: 20, priority: 12 },
          { name: PLANNER_INTENTIONS.optionalSkip, boost: 12, priority: 7 },
        ],
        ({ userText }) => {
          if (looksLikeOptionalRefusal(userText)) {
            return PLANNER_INTENTIONS.optionalSkip;
          }
          if (userText.trim().length >= 2) {
            return PLANNER_INTENTIONS.salesDiscovery;
          }
          return null;
        },
      ),
    );
  }
}

@Injectable()
export class DemoSalesConsentNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering = isAnsweringPriorAsk(ctx.visitCount('salesConsent'));

    if (
      answering &&
      (isConsentYes(ctx.intention, PLANNER_INTENTIONS.salesConsentYes) ||
        ctx.memory.contactConsent === 'granted')
    ) {
      ctx.memory.contactConsent = 'granted';
      ctx.memory.outcome = 'sales_lead';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactConsentGranted);
      return ctx.output.continueTo({ nodeId: 'contactMethod' });
    }
    if (
      answering &&
      isConsentNo(ctx.intention, PLANNER_INTENTIONS.salesConsentNo)
    ) {
      ctx.memory.contactConsent = 'declined';
      await stampAnalyticsTag(
        ctx,
        PLANNER_ANALYTICS_TAGS.contactConsentDeclined,
      );
      return ctx.output.continueTo({ nodeId: 'salesNoContactEnd' });
    }

    const visits = ctx.visitCount('salesConsent');
    if (visits <= 1 || !answering) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactOffered, {
        purpose: 'sales',
      });
      return ctx.output.sayAndListen(
        SALES_CONSENT_ASK,
        consentListen(
          PLANNER_INTENTIONS.salesConsentYes,
          PLANNER_INTENTIONS.salesConsentNo,
        ),
      );
    }
    if (!ctx.memory.consentClarifyUsed) {
      ctx.memory.consentClarifyUsed = true;
      return ctx.output.sayAndListen(
        SALES_CONSENT_CLARIFY,
        consentListen(
          PLANNER_INTENTIONS.salesConsentYes,
          PLANNER_INTENTIONS.salesConsentNo,
        ),
      );
    }
    ctx.memory.contactConsent = 'declined';
    return ctx.output.continueTo({ nodeId: 'salesNoContactEnd' });
  }
}

@Injectable()
export class DemoSalesNoContactEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.outcome = 'demo_completed';
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted, {
      outcome: 'demo_completed',
    });
    return ctx.output.endCall('No problem. Thanks for trying Vapi Studio!');
  }
}

// ─── Support ─────────────────────────────────────────────────────────────────

@Injectable()
export class DemoSupportEntryNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.contactPurpose = 'support_help';
    ctx.memory.primaryIntent = 'support';
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.supportPath);
    if (ctx.memory.supportIssue) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.supportIssueExtracted);
      return ctx.output.continueTo({ nodeId: 'supportDetail' });
    }
    return ctx.output.continueTo({ nodeId: 'supportIssue' });
  }
}

function supportIssueListen(): ListenExpectation {
  return portalListen(
    [{ name: PLANNER_INTENTIONS.supportIssue, boost: 20, priority: 12 }],
    ({ userText }) =>
      userText.trim().length >= 3 ? PLANNER_INTENTIONS.supportIssue : null,
  );
}

@Injectable()
export class DemoSupportIssueNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('supportIssue')) &&
      ctx.intention === PLANNER_INTENTIONS.supportIssue;

    if (answering) {
      applyEntryFacts(ctx);
      const raw = (ctx.userText || '').trim().slice(0, 400);
      if (!ctx.memory.supportIssue && raw.length >= 3) {
        ctx.memory.supportIssue = raw;
      }
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.supportIssueExtracted);
      return ctx.output.continueTo({ nodeId: 'supportDetail' });
    }

    return ctx.output.sayAndListen(SUPPORT_ISSUE_ASK, supportIssueListen());
  }
}

function supportDetailListen(): ListenExpectation {
  return portalListen(
    [
      { name: PLANNER_INTENTIONS.supportDetail, boost: 20, priority: 12 },
      { name: PLANNER_INTENTIONS.optionalSkip, boost: 14, priority: 8 },
    ],
    ({ userText }) => {
      if (
        looksLikeOptionalRefusal(userText) ||
        /\b(don'?t know|not sure|no idea|that'?s (it|all)|nothing else)\b/i.test(userText)
      ) {
        return PLANNER_INTENTIONS.optionalSkip;
      }
      return userText.trim().length >= 2 ? PLANNER_INTENTIONS.supportDetail : null;
    },
    ['Steps / error / version → support_detail; nothing more → optional_skip'],
  );
}

/**
 * One follow-up for the issue (steps, error, version), then mail the report to
 * the Studio team right away — before any consent question.
 */
@Injectable()
export class DemoSupportDetailNode extends AgentNode<PlannerSchema> {
  constructor(private readonly leadMail: PlannerLeadMailService) {
    super();
  }

  async before(ctx: NodeContext<PlannerSchema>): Promise<boolean> {
    return acceptsSkip(ctx, 'supportDetail');
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('supportDetail')) &&
      (ctx.intention === PLANNER_INTENTIONS.supportDetail ||
        ctx.intention === PLANNER_INTENTIONS.optionalSkip);

    if (!answering) {
      return ctx.output.sayAndListen(SUPPORT_DETAIL_ASK, supportDetailListen());
    }

    if (ctx.intention === PLANNER_INTENTIONS.supportDetail) {
      const raw = (ctx.userText || '').trim().slice(0, 600);
      if (raw) ctx.memory.supportDetail = raw;
    }
    await this.leadMail.notifyIssueReport(ctx);
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.issueReported);
    return ctx.output.continueTo({ nodeId: 'supportConsent' });
  }
}

@Injectable()
export class DemoSupportConsentNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering = isAnsweringPriorAsk(ctx.visitCount('supportConsent'));

    if (
      answering &&
      isConsentYes(ctx.intention, PLANNER_INTENTIONS.supportConsentYes)
    ) {
      ctx.memory.contactConsent = 'granted';
      ctx.memory.outcome = 'support_request';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactConsentGranted);
      return ctx.output.continueTo({ nodeId: 'contactMethod' });
    }
    if (
      answering &&
      isConsentNo(ctx.intention, PLANNER_INTENTIONS.supportConsentNo)
    ) {
      ctx.memory.contactConsent = 'declined';
      await stampAnalyticsTag(
        ctx,
        PLANNER_ANALYTICS_TAGS.contactConsentDeclined,
      );
      return ctx.output.continueTo({ nodeId: 'supportNoContactEnd' });
    }

    const visits = ctx.visitCount('supportConsent');
    if (visits <= 1 || !answering) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactOffered, {
        purpose: 'support',
      });
      return ctx.output.sayAndListen(
        SUPPORT_CONSENT_ASK,
        consentListen(
          PLANNER_INTENTIONS.supportConsentYes,
          PLANNER_INTENTIONS.supportConsentNo,
        ),
      );
    }
    if (!ctx.memory.consentClarifyUsed) {
      ctx.memory.consentClarifyUsed = true;
      return ctx.output.sayAndListen(
        SUPPORT_CONSENT_CLARIFY,
        consentListen(
          PLANNER_INTENTIONS.supportConsentYes,
          PLANNER_INTENTIONS.supportConsentNo,
        ),
      );
    }
    ctx.memory.contactConsent = 'declined';
    return ctx.output.continueTo({ nodeId: 'supportNoContactEnd' });
  }
}

@Injectable()
export class DemoSupportNoContactEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.outcome = 'demo_completed';
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    return ctx.output.endCall(
      'No problem — the team has your report. Thanks for flagging it!',
    );
  }
}

// ─── Docs question ───────────────────────────────────────────────────────────

function looksLikeDocsDone(text: string): boolean {
  const t = text.trim();
  return (
    /\b(that'?s (it|all)|nothing else|no more|i'?m (good|done|all set)|all good|no thanks?|nope|nah|we'?re good)\b/i.test(t) ||
    /^(no|nope|nah|thanks?|thank you|ok(ay)?|cool|great|perfect)[.! ]*$/i.test(t)
  );
}

function docsListen(afterAnswer: boolean): ListenExpectation {
  return portalListen(
    [
      { name: PLANNER_INTENTIONS.docsQuestion, boost: 20, priority: 12 },
      ...(afterAnswer
        ? [
            { name: PLANNER_INTENTIONS.docsDone, boost: 20, priority: 12 },
            { name: PLANNER_INTENTIONS.entrySupport, boost: 16, priority: 10 },
            { name: PLANNER_INTENTIONS.entrySales, boost: 16, priority: 10 },
          ]
        : []),
    ],
    ({ userText }) => {
      const t = userText.trim();
      if (afterAnswer) {
        if (looksLikeDocsDone(t)) return PLANNER_INTENTIONS.docsDone;
        const intent = detectEntryIntent(t);
        if (intent === 'support') return PLANNER_INTENTIONS.entrySupport;
        if (intent === 'sales_or_use_case' && !looksLikeStudioQuestion(t)) {
          return PLANNER_INTENTIONS.entrySales;
        }
      }
      return t.length >= 2 ? PLANNER_INTENTIONS.docsQuestion : null;
    },
    afterAnswer
      ? [
          'Another Studio question → docs_question',
          'No / that’s all → docs_done',
          'Something broken → entry_support; their business → entry_sales',
        ]
      : ['Their Studio question → docs_question'],
  );
}

/**
 * Answers Studio questions from the public GitHub repos (docs advisor), then
 * asks for another one. Unanswerable questions go to the Studio team by mail.
 */
@Injectable()
export class DemoDocsAnswerNode extends AgentNode<PlannerSchema> {
  constructor(
    private readonly docs: DocsAdvisorService,
    private readonly leadMail: PlannerLeadMailService,
  ) {
    super();
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.contactPurpose = 'none';
    if (ctx.visitCount('docsAnswer') <= 1) {
      ctx.memory.primaryIntent = 'docs_question';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.docsPath);
      const pending = ctx.memory.docsQuestion;
      if (!pending) {
        return ctx.output.sayAndListen(DOCS_QUESTION_ASK, docsListen(false));
      }
      return this.answer(ctx, pending);
    }

    const said = (ctx.userText || '').trim();
    if (ctx.intention === PLANNER_INTENTIONS.docsDone) {
      return ctx.output.continueTo({ nodeId: 'docsEnd' });
    }
    if (ctx.intention === PLANNER_INTENTIONS.docsQuestion && said) {
      // "Yes" to "Anything else?" — ask for the question instead of answering "yes".
      if (softYes(said) && !docsQuestionFrom(said)) {
        return ctx.output.sayAndListen(DOCS_QUESTION_ASK, docsListen(false));
      }
      return this.answer(ctx, said);
    }
    return ctx.output.sayAndListen(DOCS_QUESTION_ASK, docsListen(false));
  }

  private async answer(
    ctx: NodeContext<PlannerSchema>,
    question: string,
  ): Promise<NodeResult> {
    ctx.memory.docsQuestion = undefined;
    await ctx.output.say(DOCS_LOOKUP);
    const history = ctx.memory.docsHistory || [];
    const answer = await this.docs.answer(question, history);
    let spoken: string;
    if (answer) {
      ctx.memory.docsAnswered = (ctx.memory.docsAnswered || 0) + 1;
      ctx.memory.docsHistory = [...history, { question, answer }].slice(-3);
      ctx.memory.outcome = 'docs_answered';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.docsAnswered);
      spoken = answer;
    } else {
      await this.leadMail.notifyDocsQuestionUnanswered(ctx, question);
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.docsUnanswered);
      spoken = DOCS_UNAVAILABLE;
    }
    if ((ctx.memory.docsAnswered || 0) >= MAX_DOCS_ANSWERS) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
      return ctx.output.endCall(withCta(spoken, DOCS_END));
    }
    return ctx.output.sayAndListen(withCta(spoken, DOCS_MORE_ASK), docsListen(true));
  }
}

@Injectable()
export class DemoDocsEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.outcome = ctx.memory.docsAnswered ? 'docs_answered' : 'demo_completed';
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    return ctx.output.endCall(DOCS_END);
  }
}

// ─── Feature ─────────────────────────────────────────────────────────────────

@Injectable()
export class DemoFeatureEntryNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.contactPurpose = 'feature_discussion';
    ctx.memory.primaryIntent = 'feature_request';
    applyEntryFacts(ctx);
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.featurePath);
    if (ctx.memory.featureDescription) {
      return ctx.output.continueTo({ nodeId: 'featureConsent' });
    }
    return ctx.output.continueTo({ nodeId: 'featureDescription' });
  }
}

function shortFeatureAck(feat: string): string {
  const sliced = feat.slice(0, 60);
  return `Got it — ${sliced}${feat.length > 60 ? '…' : ''}`;
}

@Injectable()
export class DemoFeatureDescriptionNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('featureDescription')) &&
      ctx.intention === PLANNER_INTENTIONS.featureDescription;

    if (answering) {
      applyEntryFacts(ctx);
      const raw = (ctx.userText || '').trim().slice(0, 400);
      if (!ctx.memory.featureDescription && raw.length >= 5) {
        ctx.memory.featureDescription = raw;
      }
      await stampAnalyticsTag(
        ctx,
        PLANNER_ANALYTICS_TAGS.featureRequestExtracted,
      );
      return ctx.output.continueTo({ nodeId: 'featureConsent' });
    }

    return ctx.output.sayAndListen(
      FEATURE_ASK,
      portalListen(
        [
          {
            name: PLANNER_INTENTIONS.featureDescription,
            boost: 20,
            priority: 12,
          },
        ],
        ({ userText }) =>
          userText.trim().length >= 5
            ? PLANNER_INTENTIONS.featureDescription
            : null,
      ),
    );
  }
}

@Injectable()
export class DemoFeatureConsentNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering = isAnsweringPriorAsk(ctx.visitCount('featureConsent'));

    if (
      answering &&
      isConsentYes(ctx.intention, PLANNER_INTENTIONS.featureConsentYes)
    ) {
      ctx.memory.contactConsent = 'granted';
      ctx.memory.outcome = 'feature_request';
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactConsentGranted);
      return ctx.output.continueTo({ nodeId: 'contactMethod' });
    }
    if (
      answering &&
      isConsentNo(ctx.intention, PLANNER_INTENTIONS.featureConsentNo)
    ) {
      ctx.memory.contactConsent = 'declined';
      ctx.memory.outcome = 'feature_request';
      await stampAnalyticsTag(
        ctx,
        PLANNER_ANALYTICS_TAGS.contactConsentDeclined,
      );
      return ctx.output.continueTo({ nodeId: 'featureNoContactEnd' });
    }

    const visits = ctx.visitCount('featureConsent');
    if (visits <= 1 || !answering) {
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.contactOffered, {
        purpose: 'feature',
      });
      const prefix = ctx.memory.featureDescription
        ? shortFeatureAck(ctx.memory.featureDescription)
        : '';
      return ctx.output.sayAndListen(
        withCta(prefix, FEATURE_CONSENT_ASK),
        consentListen(
          PLANNER_INTENTIONS.featureConsentYes,
          PLANNER_INTENTIONS.featureConsentNo,
        ),
      );
    }
    if (!ctx.memory.consentClarifyUsed) {
      ctx.memory.consentClarifyUsed = true;
      return ctx.output.sayAndListen(
        FEATURE_CONSENT_CLARIFY,
        consentListen(
          PLANNER_INTENTIONS.featureConsentYes,
          PLANNER_INTENTIONS.featureConsentNo,
        ),
      );
    }
    ctx.memory.contactConsent = 'declined';
    ctx.memory.outcome = 'feature_request';
    return ctx.output.continueTo({ nodeId: 'featureNoContactEnd' });
  }
}

@Injectable()
export class DemoFeatureNoContactEndNode extends AgentNode<PlannerSchema> {
  constructor(private readonly leadMail: PlannerLeadMailService) {
    super();
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.outcome = 'feature_request';
    await this.leadMail.notifyDemoOutcome(ctx, 'feature_no_contact');
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.featureRequestCreated, {
      contact: false,
    });
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    return ctx.output.endCall('Got it. Thanks for the suggestion!');
  }
}

// ─── Shared contact ──────────────────────────────────────────────────────────

function contactEmailOnFile(ctx: NodeContext<PlannerSchema>): string | null {
  const fromMemory = ctx.memory.contactEmail?.trim();
  if (fromMemory) return fromMemory;
  const fromVars = ctx.conversation.variables.contactEmail?.trim();
  return fromVars || null;
}

function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function preferContactListen(): ListenExpectation {
  return portalListen(
    [
      {
        name: PLANNER_INTENTIONS.contactPreferEmail,
        boost: 22,
        priority: 12,
      },
      {
        name: PLANNER_INTENTIONS.contactPreferCall,
        boost: 22,
        priority: 12,
      },
    ],
    ({ userText }) => {
      if (/\b(e-?mails?|mail)\b/i.test(userText)) {
        return PLANNER_INTENTIONS.contactPreferEmail;
      }
      if (/\b(call|phone|ring|mobile|cellphone)\b/i.test(userText)) {
        return PLANNER_INTENTIONS.contactPreferCall;
      }
      return null;
    },
    ['email → contact_prefer_email; call/phone → contact_prefer_call'],
  );
}

@Injectable()
export class DemoContactMethodNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    if (ctx.memory.contactConsent !== 'granted') {
      return ctx.output.continueTo({ nodeId: 'contactFailureEnd' });
    }

    const email = contactEmailOnFile(ctx);
    if (email && !ctx.memory.contactEmail) {
      ctx.memory.contactEmail = email;
    }

    // Collecting missing email after they chose email.
    if (
      ctx.memory.contactPrefer === 'email' &&
      !contactEmailOnFile(ctx) &&
      isAnsweringPriorAsk(ctx.visitCount('contactMethod')) &&
      (ctx.intention === PLANNER_INTENTIONS.contactEmailCollect ||
        Boolean(extractEmail(ctx.userText || '')))
    ) {
      const parsed = extractEmail(ctx.userText || '');
      if (parsed) {
        ctx.memory.contactEmail = parsed;
        return ctx.output.continueTo({ nodeId: 'emitOutcome' });
      }
      if (!ctx.memory.contactEmailRetryUsed) {
        ctx.memory.contactEmailRetryUsed = true;
        return ctx.output.sayAndListen(
          "I didn't catch a full email. Could you say it once more?",
          portalListen(
            [
              {
                name: PLANNER_INTENTIONS.contactEmailCollect,
                boost: 20,
                priority: 12,
              },
            ],
            ({ userText }) =>
              extractEmail(userText)
                ? PLANNER_INTENTIONS.contactEmailCollect
                : null,
          ),
        );
      }
      return ctx.output.continueTo({ nodeId: 'contactFailureEnd' });
    }

    const answeringPrefer =
      isAnsweringPriorAsk(ctx.visitCount('contactMethod')) &&
      (ctx.intention === PLANNER_INTENTIONS.contactPreferEmail ||
        ctx.intention === PLANNER_INTENTIONS.contactPreferCall);

    if (answeringPrefer) {
      if (ctx.intention === PLANNER_INTENTIONS.contactPreferEmail) {
        ctx.memory.contactPrefer = 'email';
        if (contactEmailOnFile(ctx)) {
          return ctx.output.continueTo({ nodeId: 'emitOutcome' });
        }
        return ctx.output.sayAndListen(
          CONTACT_EMAIL_ASK,
          portalListen(
            [
              {
                name: PLANNER_INTENTIONS.contactEmailCollect,
                boost: 20,
                priority: 12,
              },
            ],
            ({ userText }) =>
              extractEmail(userText)
                ? PLANNER_INTENTIONS.contactEmailCollect
                : userText.includes('@')
                  ? PLANNER_INTENTIONS.contactEmailCollect
                  : null,
          ),
        );
      }

      ctx.memory.contactPrefer = 'call';
      const phone = callerPhoneFromVars(ctx.conversation.variables);
      if (phone) {
        ctx.memory.callerPhoneReuseConsent = 'unknown';
        return ctx.output.continueTo({ nodeId: 'callerPhoneConsent' });
      }
      ctx.memory.callerPhoneReuseConsent = 'unavailable';
      return ctx.output.continueTo({ nodeId: 'requestPhone' });
    }

    const ask = email ? CONTACT_PREFER_ASK_WITH_EMAIL : CONTACT_PREFER_ASK;
    return ctx.output.sayAndListen(ask, preferContactListen());
  }
}

@Injectable()
export class DemoCallerPhoneConsentNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering = isAnsweringPriorAsk(ctx.visitCount('callerPhoneConsent'));

    if (
      answering &&
      isConsentYes(ctx.intention, PLANNER_INTENTIONS.phoneReuseYes)
    ) {
      const phone = callerPhoneFromVars(ctx.conversation.variables);
      ctx.memory.callerPhoneReuseConsent = 'granted';
      if (phone) ctx.memory.contactPhone = phone;
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.callerPhoneReuseGranted);
      return ctx.output.continueTo({ nodeId: 'emitOutcome' });
    }
    if (
      answering &&
      isConsentNo(ctx.intention, PLANNER_INTENTIONS.phoneReuseNo)
    ) {
      ctx.memory.callerPhoneReuseConsent = 'declined';
      return ctx.output.continueTo({ nodeId: 'requestPhone' });
    }

    if (ctx.visitCount('callerPhoneConsent') <= 1 || !answering) {
      return ctx.output.sayAndListen(
        CALLER_PHONE_ASK,
        consentListen(
          PLANNER_INTENTIONS.phoneReuseYes,
          PLANNER_INTENTIONS.phoneReuseNo,
        ),
      );
    }
    // Ambiguous → request phone
    return ctx.output.continueTo({ nodeId: 'requestPhone' });
  }
}

@Injectable()
export class DemoRequestPhoneNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const answering =
      isAnsweringPriorAsk(ctx.visitCount('requestPhone')) &&
      Boolean((ctx.userText || '').trim()) &&
      ctx.intention === PLANNER_INTENTIONS.contactPhone;

    if (answering) {
      const phone = extractPhoneDigits(ctx.userText || '');
      if (phone) {
        ctx.memory.contactPhone = phone;
        await stampAnalyticsTag(
          ctx,
          PLANNER_ANALYTICS_TAGS.contactPhoneCollected,
        );
        return ctx.output.continueTo({ nodeId: 'emitOutcome' });
      }
      if (!ctx.memory.phoneRetryUsed) {
        ctx.memory.phoneRetryUsed = true;
        return ctx.output.sayAndListen(REQUEST_PHONE_RETRY, phoneListen());
      }
      return ctx.output.continueTo({ nodeId: 'contactFailureEnd' });
    }

    return ctx.output.sayAndListen(REQUEST_PHONE_ASK, phoneListen());
  }
}

@Injectable()
export class DemoEmitOutcomeNode extends AgentNode<PlannerSchema> {
  constructor(private readonly leadMail: PlannerLeadMailService) {
    super();
  }

  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    const outcome = ctx.memory.outcome || 'none';
    const ok =
      ctx.memory.contactConsent === 'granted' &&
      (Boolean(ctx.memory.contactPhone) ||
        (ctx.memory.contactPrefer === 'email' &&
          Boolean(contactEmailOnFile(ctx))));

    if (!ok) {
      return ctx.output.continueTo({ nodeId: 'contactFailureEnd' });
    }

    if (outcome === 'sales_lead') {
      await this.leadMail.notifyDemoOutcome(ctx, 'sales_lead');
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.salesLeadCreated);
      return ctx.output.continueTo({ nodeId: 'salesSuccessEnd' });
    }
    if (outcome === 'support_request') {
      await this.leadMail.notifyDemoOutcome(ctx, 'support_request');
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.supportRequestCreated);
      return ctx.output.continueTo({ nodeId: 'supportSuccessEnd' });
    }
    if (outcome === 'feature_request') {
      await this.leadMail.notifyDemoOutcome(ctx, 'feature_request');
      await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.featureRequestCreated, {
        contact: true,
      });
      return ctx.output.continueTo({ nodeId: 'featureSuccessEnd' });
    }
    return ctx.output.continueTo({ nodeId: 'contactFailureEnd' });
  }
}

@Injectable()
export class DemoSalesSuccessEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    const viaEmail = ctx.memory.contactPrefer === 'email';
    return ctx.output.endCall(
      viaEmail
        ? "Perfect — we'll follow up by email. Thanks for trying Vapi Studio!"
        : "Perfect. I'll pass that along. Thanks for trying Vapi Studio!",
    );
  }
}

@Injectable()
export class DemoSupportSuccessEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    const viaEmail = ctx.memory.contactPrefer === 'email';
    return ctx.output.endCall(
      viaEmail
        ? "Perfect — the team will email you about it. Thanks for flagging it!"
        : "Perfect — the team will call you about it. Thanks for flagging it!",
    );
  }
}

@Injectable()
export class DemoFeatureSuccessEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    const viaEmail = ctx.memory.contactPrefer === 'email';
    return ctx.output.endCall(
      viaEmail
        ? "Perfect — we'll email you if we dig into that idea. Thanks!"
        : "Perfect. I've got it. Thanks for the suggestion!",
    );
  }
}

@Injectable()
export class DemoContactFailureEndNode extends AgentNode<PlannerSchema> {
  async run(ctx: NodeContext<PlannerSchema>): Promise<NodeResult> {
    ctx.memory.outcome = ctx.memory.outcome || 'demo_completed';
    await stampAnalyticsTag(ctx, PLANNER_ANALYTICS_TAGS.demoCompleted);
    return ctx.output.endCall(
      "No worries. We won't hold up the demo over that. Thanks for trying Vapi Studio!",
    );
  }
}

// ─── Listen helpers ──────────────────────────────────────────────────────────

function consentListen(yesName: string, noName: string): ListenExpectation {
  return portalListen(
    [
      { name: yesName, boost: 22, priority: 12 },
      { name: noName, boost: 22, priority: 12 },
    ],
    ({ userText }) => {
      if (softYes(userText)) return yesName;
      if (softNo(userText)) return noName;
      return null;
    },
    ['Explicit yes → grant; explicit no → decline; else clarify once'],
  );
}

function phoneListen(): ListenExpectation {
  return portalListen(
    [{ name: PLANNER_INTENTIONS.contactPhone, boost: 20, priority: 12 }],
    ({ userText }) => {
      // Any digit-ish attempt → contact_phone so requestPhone can parse or retry
      // (do not fall through to Brain, which used to route to emitOutcome).
      const digits = userText.replace(/\D/g, '');
      if (digits.length >= 3) return PLANNER_INTENTIONS.contactPhone;
      if (extractPhoneDigits(userText)) return PLANNER_INTENTIONS.contactPhone;
      return null;
    },
  );
}

// ─── Intentions ──────────────────────────────────────────────────────────────

function isConsentYes(
  intention: string | null | undefined,
  yesName: string,
): boolean {
  return intention === yesName;
}

function isConsentNo(
  intention: string | null | undefined,
  noName: string,
): boolean {
  return intention === noName;
}

/** Match-phase entry intentions with heuristic match(). */
@Injectable()
export class EntrySalesIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entrySales;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;
  // Score only — Goto would become studio.goto.greet and strip entry_sales.

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return detectEntryIntent(ctx.userText) === 'sales_or_use_case'
      ? 0.9
      : null;
  }
}

@Injectable()
export class EntrySupportIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entrySupport;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return detectEntryIntent(ctx.userText) === 'support' ? 0.9 : null;
  }
}

@Injectable()
export class EntryFeatureIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entryFeature;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return detectEntryIntent(ctx.userText) === 'feature_request'
      ? 0.9
      : null;
  }
}

@Injectable()
export class EntryDocsIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entryDocs;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return detectEntryIntent(ctx.userText) === 'docs_question' ? 0.9 : null;
  }
}

@Injectable()
export class DocsQuestionIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.docsQuestion;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'docsAnswer';
  reason = PLANNER_INTENTIONS.docsQuestion;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'docsAnswer',
      reason: PLANNER_INTENTIONS.docsQuestion,
    };
  }
}

@Injectable()
export class DocsDoneIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.docsDone;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'docsEnd';
  reason = PLANNER_INTENTIONS.docsDone;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'docsEnd',
      reason: PLANNER_INTENTIONS.docsDone,
    };
  }
}

@Injectable()
export class SupportDetailIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.supportDetail;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'supportDetail';
  reason = PLANNER_INTENTIONS.supportDetail;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'supportDetail',
      reason: PLANNER_INTENTIONS.supportDetail,
    };
  }
}

@Injectable()
export class EntryExploringIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entryExploring;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 18;
  priority = 11;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return detectEntryIntent(ctx.userText) === 'exploring' ? 0.9 : null;
  }
}

@Injectable()
export class EntryClarifyIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.entryClarify;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 10;
  priority = 5;
  toNodeId = 'clarifyEntry';
  reason = PLANNER_INTENTIONS.entryClarify;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'clarifyEntry',
      reason: PLANNER_INTENTIONS.entryClarify,
    };
  }
}

@Injectable()
export class SalesBusinessIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.salesBusiness;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'salesBusiness';
  reason = PLANNER_INTENTIONS.salesBusiness;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'salesBusiness',
      reason: PLANNER_INTENTIONS.salesBusiness,
    };
  }
}

@Injectable()
export class SalesUseCaseIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.salesUseCase;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'salesUseCase';
  reason = PLANNER_INTENTIONS.salesUseCase;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'salesUseCase',
      reason: PLANNER_INTENTIONS.salesUseCase,
    };
  }
}

@Injectable()
export class SalesDiscoveryIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.salesDiscovery;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'salesDiscovery';
  reason = PLANNER_INTENTIONS.salesDiscovery;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'salesDiscovery',
      reason: PLANNER_INTENTIONS.salesDiscovery,
    };
  }
}

@Injectable()
export class SalesConsentYesIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.salesConsentYes;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softYes(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class SalesConsentNoIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.salesConsentNo;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softNo(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class SupportIssueIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.supportIssue;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'supportIssue';
  reason = PLANNER_INTENTIONS.supportIssue;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'supportIssue',
      reason: PLANNER_INTENTIONS.supportIssue,
    };
  }
}

@Injectable()
export class SupportConsentYesIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.supportConsentYes;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softYes(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class SupportConsentNoIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.supportConsentNo;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softNo(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class FeatureDescriptionIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.featureDescription;
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 18;
  priority = 10;
  toNodeId = 'featureDescription';
  reason = PLANNER_INTENTIONS.featureDescription;

  async run(): Promise<IntentionRunResult | null> {
    return {
      kind: INTENTION_RUN_KIND.Goto,
      nodeId: 'featureDescription',
      reason: PLANNER_INTENTIONS.featureDescription,
    };
  }
}

@Injectable()
export class FeatureConsentYesIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.featureConsentYes;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softYes(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class FeatureConsentNoIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.featureConsentNo;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softNo(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class PhoneReuseYesIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.phoneReuseYes;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softYes(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class PhoneReuseNoIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.phoneReuseNo;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return softNo(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class ContactPhoneIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.contactPhone;
  // Score only — Goto / multi-node flow binding skipped requestPhone parse.
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    const digits = (ctx.userText || '').replace(/\D/g, '');
    if (digits.length >= 3) return 0.95;
    return extractPhoneDigits(ctx.userText || '') ? 0.95 : null;
  }
}

@Injectable()
export class ContactPreferEmailIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.contactPreferEmail;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 22;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return /\b(e-?mails?|mail)\b/i.test(ctx.userText) ? 0.95 : null;
  }
}

@Injectable()
export class ContactPreferCallIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.contactPreferCall;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 22;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return /\b(call|phone|ring|mobile|cellphone)\b/i.test(ctx.userText)
      ? 0.95
      : null;
  }
}

@Injectable()
export class ContactEmailCollectIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.contactEmailCollect;
  phase = INTENTION_CASCADE_PHASE.Match;
  boost = 20;
  priority = 12;

  async match(ctx: IntentionContext<PlannerSchema>): Promise<number | null> {
    if (!ctx.listenIntentionNames.includes(this.name)) return null;
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(ctx.userText)
      ? 0.95
      : null;
  }
}

@Injectable()
export class OptionalSkipIntention extends CodeIntention<PlannerSchema> {
  readonly name = PLANNER_INTENTIONS.optionalSkip;
  // Listen resolveIntention owns routing — Match Goto would strip optional_skip.
  phase = INTENTION_CASCADE_PHASE.Scan;
  boost = 14;
  priority = 8;
  reason = PLANNER_INTENTIONS.optionalSkip;
}

/** Recovery prompts keyed by origin for portals. */
export function demoRecoveryForOrigin(origin: string): {
  say: string;
  listen: ListenExpectation;
} | null {
  switch (origin) {
    case 'greet':
    case 'clarifyEntry':
      return {
        say: DIDNT_QUITE_GET_IT + CLARIFY_ENTRY,
        listen: portalListen(
          entryListenIntentions(),
          ({ userText }) => clarifyResolve(userText) || PLANNER_INTENTIONS.entryExploring,
        ),
      };
    case 'salesBusiness':
      return {
        say: DIDNT_QUITE_GET_IT + SALES_BUSINESS_ASK,
        listen: portalListen(
          [
            { name: PLANNER_INTENTIONS.salesBusiness, boost: 20, priority: 12 },
            { name: PLANNER_INTENTIONS.optionalSkip, boost: 14, priority: 8 },
          ],
          ({ userText }) => {
            if (looksLikeOptionalRefusal(userText)) {
              return PLANNER_INTENTIONS.optionalSkip;
            }
            return userText.trim().length >= 2
              ? PLANNER_INTENTIONS.salesBusiness
              : null;
          },
        ),
      };
    case 'salesUseCase':
      return {
        say: DIDNT_QUITE_GET_IT + SALES_USE_CASE_ASK,
        listen: scenarioListen(),
      };
    case 'salesDiscovery':
      return {
        say: DIDNT_QUITE_GET_IT + SALES_DISCOVERY_ASK,
        listen: portalListen(
          [
            {
              name: PLANNER_INTENTIONS.salesDiscovery,
              boost: 20,
              priority: 12,
            },
            { name: PLANNER_INTENTIONS.optionalSkip, boost: 12, priority: 7 },
          ],
          ({ userText }) => {
            if (looksLikeOptionalRefusal(userText)) {
              return PLANNER_INTENTIONS.optionalSkip;
            }
            return userText.trim().length >= 2
              ? PLANNER_INTENTIONS.salesDiscovery
              : null;
          },
        ),
      };
    case 'docsAnswer':
      return {
        say: DIDNT_QUITE_GET_IT + DOCS_QUESTION_ASK,
        listen: docsListen(true),
      };
    case 'salesConsent':
      return {
        say: DIDNT_QUITE_GET_IT + SALES_CONSENT_CLARIFY,
        listen: consentListen(
          PLANNER_INTENTIONS.salesConsentYes,
          PLANNER_INTENTIONS.salesConsentNo,
        ),
      };
    case 'supportIssue':
      return {
        say: DIDNT_QUITE_GET_IT + SUPPORT_ISSUE_ASK,
        listen: supportIssueListen(),
      };
    case 'supportDetail':
      return {
        say: DIDNT_QUITE_GET_IT + SUPPORT_DETAIL_ASK,
        listen: supportDetailListen(),
      };
    case 'supportConsent':
      return {
        say: DIDNT_QUITE_GET_IT + SUPPORT_CONSENT_CLARIFY,
        listen: consentListen(
          PLANNER_INTENTIONS.supportConsentYes,
          PLANNER_INTENTIONS.supportConsentNo,
        ),
      };
    case 'featureDescription':
      return {
        say: DIDNT_QUITE_GET_IT + FEATURE_ASK,
        listen: portalListen(
          [
            {
              name: PLANNER_INTENTIONS.featureDescription,
              boost: 20,
              priority: 12,
            },
          ],
          ({ userText }) =>
            userText.trim().length >= 5
              ? PLANNER_INTENTIONS.featureDescription
              : null,
        ),
      };
    case 'featureConsent':
      return {
        say: DIDNT_QUITE_GET_IT + FEATURE_CONSENT_CLARIFY,
        listen: consentListen(
          PLANNER_INTENTIONS.featureConsentYes,
          PLANNER_INTENTIONS.featureConsentNo,
        ),
      };
    case 'callerPhoneConsent':
      return {
        say: DIDNT_QUITE_GET_IT + CALLER_PHONE_ASK,
        listen: consentListen(
          PLANNER_INTENTIONS.phoneReuseYes,
          PLANNER_INTENTIONS.phoneReuseNo,
        ),
      };
    case 'contactMethod':
      return {
        say: DIDNT_QUITE_GET_IT + CONTACT_PREFER_ASK,
        listen: preferContactListen(),
      };
    case 'requestPhone':
      return {
        say: DIDNT_QUITE_GET_IT + REQUEST_PHONE_ASK,
        listen: phoneListen(),
      };
    default:
      return null;
  }
}
