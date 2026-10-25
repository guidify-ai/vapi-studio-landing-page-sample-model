/**
 * Drives the real landing flow (config/flow.yaml + compiled nodes) turn by turn.
 * MockBrain only — listens resolve through the nodes' own heuristics.
 * No Postgres, no ChatGPT, no GitHub, no Resend.
 */
import 'reflect-metadata';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  EventService,
  FlowLoader,
  MockBrainAdapter,
  SupervisedConversation,
  Supervisor,
  WorkflowHandoffService,
  WorkflowLoader,
} from '@guidify-ai/vapi-studio';
import * as demo from '../../dist/conversation/nodes/planner/demo-conversation.nodes.js';
import * as portals from '../../dist/conversation/nodes/portals.nodes.js';
import * as plannerIntentions from '../../dist/conversation/intentions/planner.intentions.js';

/** Records every mail the flow asks for instead of sending it. */
export function fakeLeadMail() {
  const sent = [];
  const record =
    (kind) =>
    async (ctx, ...args) => {
      sent.push({ kind, args, memory: { ...ctx.memory } });
    };
  return {
    sent,
    notifyDemoOutcome: async (ctx, kind) =>
      sent.push({ kind: `demo:${kind}`, memory: { ...ctx.memory } }),
    notifyIssueReport: record('issue_report'),
    notifyDocsQuestionUnanswered: record('docs_unanswered'),
    notifyTransferHuman: record('transfer_human'),
    notifyMadWrap: record('mad'),
    notifySampleReady: record('sample_ready'),
    notifyQuoteRequested: record('quote'),
  };
}

/** Scenario advisor that never calls an LLM unless a test supplies `suggest`. */
export function fakeScenarios(suggest) {
  const calls = [];
  return {
    calls,
    async suggest(business, detail) {
      calls.push({ business, detail });
      if (suggest) return suggest(business, detail);
      return ['take orders', 'answer menu questions', 'book catering'];
    },
  };
}

/** Docs advisor stub: returns canned answers and records questions. */
export function fakeDocs(answer = () => 'Add it under the node listens.') {
  const questions = [];
  return {
    questions,
    async answer(question, history) {
      questions.push({ question, history });
      return answer(question, history);
    },
  };
}

const NODE_DEPS = {
  DemoFeatureNoContactEndNode: ['mail'],
  DemoEmitOutcomeNode: ['mail'],
  DemoSupportDetailNode: ['mail'],
  DemoSalesUseCaseNode: ['scenarios'],
  DemoDocsAnswerNode: ['docs', 'mail'],
  GoodbyeNode: ['mail'],
  MadNode: ['mail'],
  TransferToHumanNode: ['mail'],
};

/** Mirrors the planner intentions `src/app.module.ts` registers (the rest are legacy). */
const PLANNER_INTENTIONS_IN_APP = [
  'MadDetectIntention',
  'GibberishDetectIntention',
  'SoftContinueIntention',
  'NothingElseIntention',
];

export function buildConversation(opts = {}) {
  const deps = {
    mail: opts.mail || fakeLeadMail(),
    scenarios: opts.scenarios || fakeScenarios(),
    docs: opts.docs || fakeDocs(),
  };
  const flow = new FlowLoader();
  flow.loadFromFile(join(process.cwd(), 'config', 'flow.yaml'));

  const classes = { ...demo, ...portals };
  const nodes = new Map();
  for (const def of Object.values(flow.getFlow().nodes)) {
    const Cls = classes[def.class];
    if (!Cls) throw new Error(`flow.yaml node class ${def.class} not exported`);
    const args = (NODE_DEPS[def.class] || []).map((d) => deps[d]);
    nodes.set(def.class, new Cls(...args));
  }

  const intentions = new Map();
  const classesToRegister = [
    ...Object.values(demo).filter((Cls) => typeof Cls === 'function' && /Intention$/.test(Cls.name)),
    ...PLANNER_INTENTIONS_IN_APP.map((name) => plannerIntentions[name]),
  ];
  for (const Cls of classesToRegister) {
    const it = new Cls();
    if (typeof it.name === 'string' && it.name) intentions.set(it.name, it);
  }

  const brain = new MockBrainAdapter();
  // Only reached when a listen can't resolve locally — behaves like "didn't get that".
  brain.setSequence('landing-test', ['studio.isUnknownTransition']);
  brain.setActiveProfile('landing-test');

  const events = new EventService();
  if (!process.env.LANDING_TEST_LOGS) {
    events.log = () => undefined;
    Logger.overrideLogger(false);
  }
  const tags = [];
  const persistTag = events.persistAnalyticsTag.bind(events);
  events.persistAnalyticsTag = async (conversationId, tag, payload) => {
    tags.push({ tag, payload });
    return persistTag(conversationId, tag, payload);
  };
  events.persist = async () => undefined;

  const supervisor = new Supervisor(
    brain,
    flow,
    nodes,
    events,
    undefined,
    undefined,
    undefined,
    undefined,
    intentions,
  );

  const runtime = new SupervisedConversation({
    conversationId: 'landing-test-conv',
    providerCallId: 'landing-test-call',
    flowId: 'sample-landing-demo',
    brainProfileId: 'landing-test',
    startNodeId: 'greet',
    variables: {
      companyName: 'Vapi Studio',
      contactName: 'Vadym Test',
      contactEmail: 'visitor@example.com',
      callerChannel: 'web',
      ...(opts.variables || {}),
    },
  });

  const handoffs = new WorkflowHandoffService(
    new WorkflowLoader(),
    flow,
    events,
    { checkpoint: async () => undefined },
  );
  const transcript = [];

  /**
   * One caller turn ('' = opening). Follows continueTo hops the way the Studio
   * chat and Vapi controllers do (entry turn with empty userText).
   * Returns everything the bot said and the node that spoke last.
   */
  async function say(userText) {
    const lines = [];
    const onSay = async (text) => {
      lines.push(text);
    };
    let turn = await supervisor.handleTurn({ runtime, userText, onSay });
    const nodes = [turn.selectedNodeId];
    await handoffs.applyHandoffs(runtime, turn.actions);
    for (let hop = 0; runtime.metadata.moduleNeedsEntrySpeak === true && hop < 6; hop++) {
      turn = await supervisor.handleTurn({ runtime, userText: '', onSay });
      nodes.push(turn.selectedNodeId);
      await handoffs.applyHandoffs(runtime, turn.actions);
    }
    const bot = lines.join(' ');
    const node = runtime.currentNodeId;
    transcript.push({ user: userText, bot, node, path: nodes });
    return {
      bot,
      turn,
      node,
      path: nodes,
      listening: turn.result?.kind === 'sayAndListen',
      ended: turn.result?.kind === 'endCall',
    };
  }

  return {
    say,
    runtime,
    memory: runtime.memory,
    tags,
    transcript,
    ...deps,
  };
}
