/**
 * Landing-page voice demo — project (or exploring) / docs question / issue / feature.
 * Spec: config/demo-conversation.yml
 */

export type DemoPrimaryIntent =
  | 'sales_or_use_case'
  | 'docs_question'
  | 'support'
  | 'feature_request'
  | 'exploring'
  | 'unknown';

export type DemoContactConsent = 'granted' | 'declined' | 'unknown';

export type DemoContactPurpose =
  | 'sales_discussion'
  | 'support_help'
  | 'feature_discussion'
  | 'none';

export type DemoCallerPhoneReuse =
  | 'granted'
  | 'declined'
  | 'unknown'
  | 'unavailable';

export type DemoContactPrefer = 'email' | 'call';

export type DemoOutcome =
  | 'none'
  | 'sales_lead'
  | 'support_request'
  | 'feature_request'
  | 'docs_answered'
  | 'demo_completed';

/** Legacy planner use-case enum (design-package helper / old mail). */
export type PlannerUseCase =
  | 'qualify'
  | 'book'
  | 'faq'
  | 'dispatch'
  | 'other';

export type IntegrationInterest = 'none' | 'crm' | 'tools' | 'unknown';

export type DesignDraft = {
  funnels: Array<{ id: string; label: string }>;
  analyticsEvents: string[];
  flowNodes: Array<{ id: string; label: string; kind?: string }>;
  sampleConversation: string;
  portals?: string[];
};

export type PlannerMemory = {
  companyName?: string;
  contactName?: string;
  contactEmail?: string;

  primaryIntent?: DemoPrimaryIntent;
  /**
   * What the caller said when picking a path. Nodes reached via continueTo run
   * with an empty userText, so they read the entry answer from here.
   */
  entryUtterance?: string;
  businessDescription?: string;
  useCaseText?: string;
  /** Caller-assistant scenarios offered for their business (2–3). */
  scenarioOptions?: string[];
  /** Pending docs question (from the entry answer or the ask). */
  docsQuestion?: string;
  /** Docs questions answered this conversation. */
  docsAnswered?: number;
  /** Recent docs Q&A for follow-up questions. */
  docsHistory?: Array<{ question: string; answer: string }>;
  supportIssue?: string;
  /** Steps / error message / version for a reported issue. */
  supportDetail?: string;
  /** Issue report already mailed to the Studio team. */
  issueReportSent?: boolean;
  featureDescription?: string;
  discoverySource?: string;
  contactConsent?: DemoContactConsent;
  contactPurpose?: DemoContactPurpose;
  callerPhoneReuseConsent?: DemoCallerPhoneReuse;
  /** How they want follow-up after consent. */
  contactPrefer?: DemoContactPrefer;
  contactPhone?: string;
  /** Email collect retry already used. */
  contactEmailRetryUsed?: boolean;
  outcome?: DemoOutcome;
  /** Consent clarifier already used for current offer. */
  consentClarifyUsed?: boolean;
  /** Phone collect retry already used. */
  phoneRetryUsed?: boolean;

  /** Legacy fields kept for design-package / mail helpers. */
  companyDoes?: string;
  useCase?: PlannerUseCase;
  discoveryAnswers?: string[];
  discoveryComplete?: boolean;
  integrationInterest?: IntegrationInterest;
  designDraft?: DesignDraft;
  sampleShown?: boolean;
  offerHelp?: boolean;
  quoteRequested?: boolean;
  correctionCount?: number;
  madStrikes?: number;
  outboundDemo?: boolean;
  phoneDemoTopic?: string;
  heardAbout?: string;
  leadMailSuccessSent?: boolean;
  leadMailQuoteSent?: boolean;
  leadMailTransferSent?: boolean;
};

export type PlannerVariables = {
  companyName: string;
  afterHours?: boolean;
  callerChannel?: string;
  callerId?: string;
  contactName?: string;
  contactEmail?: string;
  guestCompanyName?: string;
  outboundDemo?: boolean;
  featureFlags?: Record<string, boolean>;
};

export type PlannerSchema = {
  variables: PlannerVariables;
  memory: PlannerMemory;
};

export const PLANNER_INTENTIONS = {
  entrySales: 'entry_sales',
  entryDocs: 'entry_docs',
  entrySupport: 'entry_support',
  entryFeature: 'entry_feature',
  entryExploring: 'entry_exploring',
  entryClarify: 'entry_clarify',

  salesBusiness: 'sales_business',
  salesUseCase: 'sales_use_case',
  salesDiscovery: 'sales_discovery',
  salesConsentYes: 'sales_consent_yes',
  salesConsentNo: 'sales_consent_no',

  docsQuestion: 'docs_question',
  docsDone: 'docs_done',

  supportIssue: 'support_issue',
  supportDetail: 'support_detail',
  supportConsentYes: 'support_consent_yes',
  supportConsentNo: 'support_consent_no',

  featureDescription: 'feature_description',
  featureConsentYes: 'feature_consent_yes',
  featureConsentNo: 'feature_consent_no',

  phoneReuseYes: 'phone_reuse_yes',
  phoneReuseNo: 'phone_reuse_no',
  contactPhone: 'contact_phone',
  contactPreferEmail: 'contact_prefer_email',
  contactPreferCall: 'contact_prefer_call',
  contactEmailCollect: 'contact_email_collect',

  optionalSkip: 'optional_skip',
  nothingElse: 'nothing_else',
  isContinue: 'isContinue',

  /** Legacy aliases (unmounted planner / old tests). */
  companyDoesCollected: 'company_does_collected',
  useCaseQualify: 'use_case_qualify',
  useCaseBook: 'use_case_book',
  useCaseFaq: 'use_case_faq',
  useCaseDispatch: 'use_case_dispatch',
  useCaseOther: 'use_case_other',
  discoveryAnswer: 'discovery_answer',
  discoveryProceed: 'discovery_proceed',
  integrationsNone: 'integrations_none',
  integrationsCrm: 'integrations_crm',
  integrationsTools: 'integrations_tools',
  sampleOk: 'sample_ok',
  sampleTweak: 'sample_tweak',
  helpBuild: 'help_build',
  productFaq: 'product_faq',
  phoneDemoWhat: 'phone_demo_what',
  phoneDemoCost: 'phone_demo_cost',
  phoneDemoNotDev: 'phone_demo_not_dev',
  phoneDemoClarify: 'phone_demo_clarify',
  phoneDemoUseCase: 'phone_demo_use_case',
  phoneDemoHeardAbout: 'phone_demo_heard_about',
} as const;

export const MAX_DISCOVERY_ANSWERS = 5;
export const MAX_CORRECTIONS = 8;

export const DISCOVERY_QUESTIONS = [
  'What specific facts should the agent get from the caller before it finishes?',
  'When should it transfer to a human — or who is not a fit?',
  'Who typically calls — and what do they usually ask first?',
  'Any tone or brand rules the agent must respect?',
  'Anything else critical before I draft the sample?',
] as const;
