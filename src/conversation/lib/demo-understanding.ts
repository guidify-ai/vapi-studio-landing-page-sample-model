/**
 * Heuristic understanding for the landing voice demo (config/demo-conversation.yml).
 * Live Brain still ranks when resolveIntention returns null; these cover MockBrain
 * and fast closed-set paths.
 *
 * Product rule: ask → listen → extract. Prefer routing that keeps volunteered
 * facts (cafe, QR, LinkedIn) over dumping people into a canned explorer script.
 */

import type {
  DemoPrimaryIntent,
  PlannerMemory,
} from '../planner-schema';
import {
  looksLikeSoftAffirmative,
  looksLikeSoftNegative,
} from './affirmative';

export function softYes(text: string): boolean {
  return looksLikeSoftAffirmative(text);
}

export function softNo(text: string): boolean {
  return looksLikeSoftNegative(text);
}

export function looksLikeOptionalRefusal(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    softNo(t) ||
    /\b(rather not|prefer not|skip|pass|don't want|do not want|none of your|private)\b/i.test(
      t,
    )
  );
}

export function looksLikeExit(text: string): boolean {
  return /\b(stop|i'?m done|that'?s enough|bye|goodbye|end the demo|hang up)\b/i.test(
    text,
  );
}

/** A concrete business or its callers: "a question about my dental clinic" is still a project. */
const BUSINESS_RE =
  /\b(business|company|clinic|cafe|coffee|pizza|dentist|dental|roof\w*|shop|store|restaurant|salon|hvac|plumb\w*|callers?|customers?|clients?|leads?)\b/i;

/**
 * Business / project / use-case signal — not “just poking at the demo”.
 * “I have / we have …” alone is not one: “I have a question” is help.
 */
export function hasProjectSignal(text: string): boolean {
  const t = text.toLowerCase();
  return (
    BUSINESS_RE.test(t) ||
    /\b(project|use\s*cases?|idea|building|qr\s*codes?|ordering|menu|appointments?|answering)\b/i.test(t) ||
    /\b(for (a|our|my)|we (run|are|own)|i (run|own)|looking (at|to|into))\b/i.test(t)
  );
}

/** Asking about Studio itself — a question, the docs, how to do something. */
export function looksLikeStudioQuestion(text: string): boolean {
  return (
    /\b(questions?|docs?|documentation|tutorial|guide|how[- ]to|readme|quick ?start)\b/i.test(text) ||
    /\bhow (do|can|should|would) (i|we)\b/i.test(text) ||
    /\bhow to\b/i.test(text) ||
    /\b(does|can|is) (vapi )?(studio|it) (support|work|handle|run|do)\b/i.test(text) ||
    /\b(what|which|where)\b.{0,30}\b(studio|node|flow|framework|package|repo|npm|install\w*|brain|intentions?|portals?)\b/i.test(text)
  );
}

const ISSUE_RE =
  /\b(isn'?t working|not working|doesn'?t work|stopped working|bugs?|broken|crash\w*|errors?|exceptions?|fail(s|ed|ing)?|stops? after|wrong (node|route)|issue with|problem with|report (a |an )?(bug|issue|problem)|complain\w*|an issue|a problem)\b/i;
const STUDIO_PART_RE =
  /\b(decision tree|extractor|portal|tool call|node|flow|studio|webhook|listen|intention|brain|yarn|docker|npm)\b/i;

/** Words that carry no content of their own in "I have a question" / "I want to report a bug". */
const FILLER_WORDS = new Set(
  (
    'i we you me my our a an the to of for on in with about and or so just some quick small few little bit ' +
    'have has had got need needs want would like could can do does please hi hey hello yeah yes ok okay well ' +
    'there here it its this that question questions help vapi studio docs doc documentation issue issues ' +
    'problem problems bug bugs report reporting something thing is are was be'
  ).split(' '),
);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (w) => w.length > 1 && !FILLER_WORDS.has(w),
  );
}

/**
 * The actual question when the entry answer already contains one
 * ("How do I add a tool to a node?"); null for "I have a question about Studio".
 */
export function docsQuestionFrom(text: string): string | null {
  const t = text.trim();
  const words = contentWords(t);
  const asks = /^(how|what|where|which|why|when|who|can|could|does|do|is|are|should|will)\b/i.test(t) || /\?\s*$/.test(t);
  if (words.length >= 2 || (asks && words.length >= 1)) return t.slice(0, 400);
  return null;
}

/** What went wrong when the entry answer already says it; null for "I want to report a bug". */
export function issueFrom(text: string): string | null {
  const t = text.trim();
  return contentWords(t).length >= 2 ? t.slice(0, 400) : null;
}

export function detectEntryIntent(text: string): DemoPrimaryIntent {
  const t = text.toLowerCase();

  if (
    /\b(feature request|you should (add|support|let)|it would be nice|i have an idea for studio|can you add|wish (studio|you)|suggest(ion)?)\b/i.test(
      t,
    )
  ) {
    return 'feature_request';
  }

  // Something in Studio is broken: "my flow stops after the extractor", "I want to report a bug".
  if (ISSUE_RE.test(t) && (STUDIO_PART_RE.test(t) || !BUSINESS_RE.test(t))) {
    return 'support';
  }

  // "I have a question about Vapi Studio", "where are the docs", "how do I add a tool".
  if (looksLikeStudioQuestion(t) && !BUSINESS_RE.test(t)) {
    return 'docs_question';
  }

  if (
    /\b(need|want|could use|looking for|get) (some |a little |a bit of )?help\b|\bhelp (me )?(with|on)\b|\bcan (you|someone) help\b/i.test(
      t,
    ) &&
    !BUSINESS_RE.test(t)
  ) {
    return 'docs_question';
  }

  const project = hasProjectSignal(t);

  // Pure exploring — no project/business meat in the utterance.
  if (
    !project &&
    (/\b(just (playing|looking|trying|curious|exploring)|looking around|checking (it |studio )?out|nothing(,| —| -)?\s*i clicked|don'?t have a project|curious|playing with (the )?demo)\b/i.test(
      t,
    ) ||
      /^(just )?(looking|exploring|explore|curious|demo|explorin'?g?)\.?$/i.test(
        t.trim(),
      ) ||
      /\b(wanna|want to|wantta)\s+explor/i.test(t) ||
      /\bexplor(e|ing|in'?)\b.{0,40}\b(what you|how (this|it|you)|studio|demo)\b/i.test(
        t,
      ) ||
      /\b(what you are|how this works|how (the )?demo works)\b/i.test(t))
  ) {
    return 'exploring';
  }

  // “explorin business idea”, QR for cafe, dental clinic, etc. → sales path.
  if (
    project ||
    /\b(looking at|evaluat|want to (build|use|talk)|could this work|for our|using vapi|talk to somebody|use case)\b/i.test(
      t,
    ) ||
    /\b(explor\w*).{0,48}\b(business|idea|project|use)\b/i.test(t) ||
    /\b(business|idea|project).{0,48}\b(explor\w*)\b/i.test(t)
  ) {
    return 'sales_or_use_case';
  }

  return 'unknown';
}

/** Pull volunteered facts from one utterance into memory (skip-if-known). */
export function extractVolunteeredFacts(
  text: string,
  memory: PlannerMemory,
): void {
  const t = text.trim();
  if (!t) return;

  if (!memory.discoverySource) {
    const src = matchDiscoverySource(t);
    if (src) memory.discoverySource = src;
  }

  if (!memory.businessDescription) {
    const biz = matchBusiness(t);
    if (biz) {
      memory.businessDescription = biz;
      memory.companyDoes = biz;
    }
  }

  if (!memory.useCaseText) {
    const uc = matchUseCase(t);
    if (uc) {
      memory.useCaseText = uc;
      memory.companyDoes = memory.companyDoes || uc;
    }
  }

  const intent = detectEntryIntent(t);
  if (!memory.supportIssue && intent === 'support') {
    const issue = issueFrom(t);
    if (issue) memory.supportIssue = issue;
  }

  if (!memory.docsQuestion && intent === 'docs_question') {
    const question = docsQuestionFrom(t);
    if (question) memory.docsQuestion = question;
  }

  if (!memory.featureDescription && intent === 'feature_request') {
    const feat = stripLeadIn(t);
    if (feat.length >= 8) memory.featureDescription = feat.slice(0, 400);
  }

  if (
    memory.contactConsent !== 'granted' &&
    memory.contactConsent !== 'declined' &&
    /\b(yes[,.]?\s*)?(have someone|someone can|team can|you can)\s+(call|contact|reach)\b/i.test(
      t,
    )
  ) {
    memory.contactConsent = 'granted';
  }
}

function stripLeadIn(t: string): string {
  return t
    .replace(
      /^(i('d| would)? like (studio )?to |you should |can you |it would be nice if |my |we )/i,
      '',
    )
    .trim();
}

function matchDiscoverySource(t: string): string | undefined {
  const platforms =
    /\b(github|linkedin|google|reddit|discord|podcast|twitter|friend)\b/i;
  const plat = t.match(platforms);
  if (plat) return plat[1];
  const heard = t.match(
    /\b(?:heard|found|saw).{0,24}\b(?:on|via|through|from)\s+([a-z0-9 ./-]{2,40})/i,
  );
  if (heard?.[1]) {
    const v = heard[1].trim().replace(/[.,!?]+$/, '');
    if (!/^vapi\b/i.test(v)) return v;
  }
  return undefined;
}

function matchBusiness(t: string): string | undefined {
  const m = t.match(
    /\b(?:we (?:run|have|are|own)|i (?:run|have|own)|(?:for (?:a|our|my)))\s+([a-z0-9 &'/-]{3,60}?)(?:\s+(?:and|that|to|for|,|\.|$))/i,
  );
  if (m?.[1]) return m[1].trim();

  const short = t.match(
    /\b(dental(?: clinic)?|dentist|pizza shop|roofing(?: company)?|coffee shop|cafe|restaurant|salon|barbershop|property management(?: company)?|call center|hvac)\b/i,
  );
  if (short) return short[1];

  // “… for cafe” / “… for a small bakery”
  const forBiz = t.match(
    /\bfor (?:a |an |our |my )?([a-z][a-z0-9 &'/-]{2,40})\s*$/i,
  );
  if (
    forBiz?.[1] &&
    !/^(us|me|them|it|that|this|studio|vapi|now|today)$/i.test(forBiz[1])
  ) {
    return forBiz[1].trim();
  }
  return undefined;
}

function matchUseCase(t: string): string | undefined {
  const m = t.match(
    /\b(?:want(?: to)?|need(?: to)?|looking to|should)\s+([a-z0-9 &'/-]{4,80}?)(?:\s+(?:and|i found|,|\.|$))/i,
  );
  if (m?.[1] && !/^(help|someone|to talk)/i.test(m[1])) {
    return m[1].trim();
  }
  const known = t.match(
    /\b(appointment booking|book appointments?|qualify(?: a)? leads?|replace(?: our)? answering service|take orders?|customer support|handle customer support|schedule an estimate|online ordering|table\s+qr(?:\s*codes?)?|qr\s*codes?(?:\s+(?:menu|ordering|orders?))?)\b/i,
  );
  if (known) return known[1];

  if (/\bqr\b/i.test(t)) {
    const snippet = t.match(/\b[\w\s-]{0,24}qr[\w\s-]{0,24}/i)?.[0]?.trim();
    return snippet && snippet.length >= 2 ? snippet : 'QR code ordering';
  }
  return undefined;
}

/** Short label for memory (not for speaking aloud). */
export function shortFact(text: string | undefined | null, max = 48): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function titleish(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function withArticle(noun: string): string {
  const n = noun.trim();
  if (!n) return 'that business';
  if (/^(a|an|the)\s/i.test(n)) return n;
  // Short single token → treat as a name ("Dodo"), not "a dodo"
  if (!/\s/.test(n) && n.length <= 14) return titleish(n);
  return /^[aeiou]/i.test(n) ? `an ${n}` : `a ${n}`;
}

/** Turn a raw use-case fragment into a spoken verb phrase. */
export function rephraseUseCaseRole(useCase: string): string {
  const t = useCase.toLowerCase().trim();
  if (!t) return 'help callers';
  if (/\b(all of|all the|everything|all above|all that)\b/.test(t)) {
    return 'handle orders, common questions, and handoffs to a person';
  }
  if (/reception/.test(t)) return 'act as a receptionist';
  if (/\btake (an )?orders?\b|\border(ing)?\b/.test(t)) return 'take orders';
  if (/appoint|\bbook\b/.test(t)) return 'book appointments';
  if (/faq|question|answer/.test(t)) return 'answer common questions';
  if (/connect|transfer|handoff|human|person/.test(t)) {
    return 'connect callers to a person when needed';
  }
  if (/qualif|lead/.test(t)) return 'qualify leads';
  if (/estimat|quote/.test(t)) return 'schedule estimates';
  if (/\bqr\b/.test(t)) return 'support table QR / menu ordering';
  if (/^to\s+/i.test(t)) return t.replace(/^to\s+/i, '');
  return `help with ${t}`;
}

/** Known verticals we can predict from the name alone. */
export type BusinessKind =
  | 'pizza'
  | 'dental'
  | 'roofing'
  | 'cafe'
  | 'salon'
  | 'restaurant'
  | 'hvac'
  | 'unknown';

export function classifyBusiness(text: string): BusinessKind {
  const t = text.toLowerCase().trim();
  if (/pizza/.test(t)) return 'pizza';
  if (/dent|orthodont|oral surg/.test(t)) return 'dental';
  if (/roof/.test(t)) return 'roofing';
  if (/cafe|coffee|espresso/.test(t)) return 'cafe';
  if (/salon|barber|spa|nail/.test(t)) return 'salon';
  if (/restaurant|diner|bistro|eatery/.test(t)) return 'restaurant';
  if (/\bhvac\b|heating|cooling|air cond/.test(t)) return 'hvac';
  // Descriptive phrase already answers "what they do"
  if (
    /\b(shop|clinic|company|practice|store|studio)\b/.test(t) &&
    t.split(/\s+/).length >= 2
  ) {
    if (/food|bake|burger|taco|sushi/.test(t)) return 'restaurant';
  }
  return 'unknown';
}

/** Three caller-assistant scenarios for a known vertical (verb phrases). */
export function scenariosForKind(kind: BusinessKind): string[] {
  switch (kind) {
    case 'pizza':
      return ['take pizza orders', 'answer hours and menu questions', 'give delivery status updates'];
    case 'dental':
      return ['book and reschedule appointments', 'answer common patient questions', 'triage urgent after-hours calls'];
    case 'roofing':
      return ['qualify new leads', 'schedule estimates', 'answer storm-damage and insurance questions'];
    case 'cafe':
      return ['take pickup orders', 'answer hours and menu questions', 'take catering requests'];
    case 'salon':
      return ['book appointments', 'answer service and pricing questions', 'handle cancellations and reschedules'];
    case 'restaurant':
      return ['take reservations', 'answer hours and menu questions', 'take pickup orders'];
    case 'hvac':
      return ['qualify service calls', 'schedule a technician visit', 'triage emergency calls after hours'];
    default:
      return [
        'answer common questions about the business',
        'take a request and pass it to the team',
        'book a callback or appointment',
      ];
  }
}

/** Offline scenarios when the LLM advisor is unavailable. */
export function fallbackScenarios(business: string): string[] {
  const kind = classifyBusiness(business);
  if (kind !== 'unknown') return scenariosForKind(kind);
  const t = business.toLowerCase();
  if (/retail|shop|store|sell|product|e-?comm|online|merch/.test(t)) {
    return ['answer product questions', 'check order and shipping status', 'handle returns and exchanges'];
  }
  if (/software|saas|app|platform|tech|agency/.test(t)) {
    return ['qualify inbound interest', 'answer product and pricing questions', 'book a demo with sales'];
  }
  if (/real estate|propert|rent|lease/.test(t)) {
    return ['qualify buyer and renter leads', 'book showings', 'take maintenance requests'];
  }
  if (/clinic|medical|health|patient|vet/.test(t)) return scenariosForKind('dental');
  return scenariosForKind('unknown');
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]}, or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/** Offer the scenarios and wait for a pick. */
export function scenarioOfferAsk(business: string, options: string[]): string {
  const label = business.trim() ? withArticle(business.trim()) : 'your business';
  return `A Studio phone assistant for ${label} could ${joinOr(options)}. Which one fits best — or is it something else?`;
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(first|1st|number one|option one|the one)\b|^\s*(one|1)\b/i, 0],
  [/\b(second|2nd|number two|option two|middle)\b|^\s*(two|2)\b/i, 1],
  [/\b(third|3rd|number three|option three)\b|^\s*(three|3)\b/i, 2],
];

function scenarioTokens(text: string): string[] {
  return contentWords(text).filter((w) => w.length >= 4 && !['answer', 'take', 'give', 'handle'].includes(w));
}

/**
 * Map the caller's reply to one of the offered scenarios ("the second one",
 * "orders", "all of them"), or keep their own words.
 */
export function pickScenario(
  text: string,
  options: string[],
): { choice: string; index: number | null; own: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  if (options.length && /\b(all( of (them|those|it))?|both|everything|each)\b/i.test(t)) {
    return { choice: joinAnd(options), index: null, own: false };
  }
  const last = options.length - 1;
  if (/\b(last|final)( one)?\b/i.test(t) && last >= 0) {
    return { choice: options[last], index: last, own: false };
  }
  for (const [re, idx] of ORDINALS) {
    if (re.test(t) && idx <= last) return { choice: options[idx], index: idx, own: false };
  }
  const said = new Set(scenarioTokens(t));
  let best = -1;
  let bestScore = 0;
  options.forEach((opt, i) => {
    const score = scenarioTokens(opt).filter((w) => said.has(w) || said.has(w.replace(/s$/, ''))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) return { choice: options[best], index: best, own: false };
  return t.length >= 3 ? { choice: t.slice(0, 200), index: null, own: true } : null;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** Sales-path ack that rephrases instead of injecting raw text. */
export function salesFactsAck(memory: {
  businessDescription?: string | null;
  useCaseText?: string | null;
  scenarioOptions?: string[] | null;
}): string {
  const biz = shortFact(memory.businessDescription);
  const picked = (memory.useCaseText || '').trim();
  // A picked scenario (or several) is already a spoken verb phrase.
  const offered =
    picked &&
    (memory.scenarioOptions || []).some((o) => picked === o || picked.includes(o));
  const uc = offered ? picked : shortFact(memory.useCaseText, 60);
  const role = offered ? picked : rephraseUseCaseRole(uc);
  if (biz && uc) {
    return `So ${withArticle(biz)} needs an assistant that can ${role} — nice.`;
  }
  if (uc) return `An assistant that can ${role} — makes sense.`;
  if (biz) return `${titleish(withArticle(biz))} — makes sense.`;
  return '';
}

/** True when this node run is answering a prior ask (not the continueTo hop from entry). */
export function isAnsweringPriorAsk(visitCount: number): boolean {
  return visitCount > 1;
}

/** Best-effort NA / E.164 phone from speech or digits. */
export function extractPhoneDigits(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function callerPhoneFromVars(vars: {
  callerId?: string;
  callerChannel?: string;
}): string | null {
  const id = (vars.callerId || '').trim();
  if (!id) return null;
  if (vars.callerChannel === 'web') return null;
  if (/^\+?\d{10,15}$/.test(id.replace(/\s/g, ''))) {
    return id.startsWith('+') ? id : extractPhoneDigits(id);
  }
  return null;
}

export function syncLegacyHeardAbout(memory: PlannerMemory): void {
  if (memory.discoverySource) {
    memory.heardAbout = memory.discoverySource;
  }
  if (memory.businessDescription && !memory.companyDoes) {
    memory.companyDoes = memory.businessDescription;
  } else if (memory.useCaseText && !memory.companyDoes) {
    memory.companyDoes = memory.useCaseText;
  }
}
