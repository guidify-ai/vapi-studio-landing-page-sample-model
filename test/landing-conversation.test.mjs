/**
 * End-to-end landing conversations through the real flow.yaml and nodes.
 * Advisors and mail are fakes — nothing reaches OpenAI, GitHub, or Resend.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildConversation,
  fakeDocs,
  fakeScenarios,
} from './helpers/conversation.mjs';

const PIZZA_SCENARIOS = ['take pizza orders', 'answer menu questions', 'book catering'];

function tagNames(c) {
  return c.tags.map((t) => t.tag);
}

function tagPayload(c, name) {
  return c.tags.find((t) => t.tag === name)?.payload;
}

describe('greeting', () => {
  it('offers project, docs question, or exploring — never says "report an issue"', async () => {
    const c = buildConversation();
    const r = await c.say('');
    assert.equal(r.node, 'greet');
    assert.ok(r.listening);
    assert.match(r.bot, /project/i);
    assert.match(r.bot, /question about Studio or its docs/i);
    assert.match(r.bot, /exploring/i);
    assert.doesNotMatch(r.bot, /\b(issue|bug|complain|problem|report)/i);
  });

  it('retry prompt keeps the same three options', async () => {
    const c = buildConversation();
    await c.say('');
    const r = await c.say('hmm');
    assert.match(r.bot, /project/i);
    assert.match(r.bot, /question about Studio or its docs/i);
    assert.match(r.bot, /exploring/i);
    assert.doesNotMatch(r.bot, /\b(issue|bug|complain|report)/i);
  });
});

describe('project path', () => {
  it('A) detects the intention, B) asks for the business, C) offers scenarios and waits, D) asks consent', async () => {
    const scenarios = fakeScenarios(() => PIZZA_SCENARIOS);
    const c = buildConversation({ scenarios });
    await c.say('');

    // A) Intention detected
    const b = await c.say('I have a project in mind');
    assert.deepEqual(tagPayload(c, 'entry_intent_detected'), { intent: 'sales_or_use_case' });
    assert.ok(tagNames(c).includes('sales_path_entered'));

    // B) Asks to describe the business in a couple of words
    assert.equal(b.node, 'salesBusiness');
    assert.ok(b.listening);
    assert.match(b.bot, /what kind of business/i);
    assert.match(b.bot, /couple of words/i);

    // C) Suggests 2–3 caller-assistant scenarios for that business and waits
    const offer = await c.say('a pizza shop');
    assert.equal(offer.node, 'salesUseCase');
    assert.ok(offer.listening, 'waits for the caller to pick');
    assert.deepEqual(scenarios.calls.map((x) => x.business), ['pizza shop']);
    assert.match(offer.bot, /phone assistant for a pizza shop/i);
    for (const option of PIZZA_SCENARIOS) assert.ok(offer.bot.includes(option), option);
    assert.match(offer.bot, /which one fits best/i);
    assert.deepEqual(c.memory.scenarioOptions, PIZZA_SCENARIOS);
    assert.deepEqual(tagPayload(c, 'use_case_scenarios_offered'), { count: 3 });

    // Caller picks one
    const pick = await c.say('the second one');
    assert.equal(c.memory.useCaseText, 'answer menu questions');
    assert.deepEqual(tagPayload(c, 'use_case_extracted'), { scenarioIndex: 1 });
    assert.match(pick.bot, /answer menu questions/);
    assert.match(pick.bot, /how did you hear about Vapi Studio/i);

    // D) Once the goal is understood, asks consent to be contacted by the team
    const consent = await c.say('LinkedIn');
    assert.equal(consent.node, 'salesConsent');
    assert.ok(consent.listening);
    assert.equal(
      consent.bot,
      'Would you like someone from the Vapi Studio team to contact you to discuss it further?',
    );
    assert.deepEqual(c.mail.sent, [], 'no lead mail before consent');

    await c.say('yes');
    const end = await c.say('email');
    assert.ok(end.ended);
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['demo:sales_lead']);
    const lead = c.mail.sent[0].memory;
    assert.equal(lead.businessDescription, 'pizza shop');
    assert.equal(lead.useCaseText, 'answer menu questions');
    assert.equal(lead.contactConsent, 'granted');
  });

  it('business named up front skips straight to the scenarios', async () => {
    const c = buildConversation();
    await c.say('');
    const r = await c.say('I have a pizza shop');
    assert.equal(r.node, 'salesUseCase');
    assert.ok(r.listening);
    assert.match(r.bot, /could .+, .+, or .+\. Which one fits best/);
  });

  it('keeps the caller’s own goal when none of the scenarios fit', async () => {
    const c = buildConversation();
    await c.say('');
    await c.say('I have a pizza shop');
    await c.say('screen job applicants');
    assert.equal(c.memory.useCaseText, 'screen job applicants');
  });

  it('declining consent ends without a lead mail', async () => {
    const c = buildConversation();
    await c.say('');
    await c.say('I have a pizza shop');
    await c.say('first');
    await c.say('rather not say');
    const r = await c.say('no');
    assert.ok(r.ended);
    assert.deepEqual(c.mail.sent, []);
    assert.ok(tagNames(c).includes('contact_consent_declined'));
  });

  it('exploring is the same path with "you pick"', async () => {
    const c = buildConversation();
    await c.say('');
    const ask = await c.say('just exploring');
    assert.deepEqual(tagPayload(c, 'entry_intent_detected'), { intent: 'exploring' });
    assert.equal(ask.node, 'salesBusiness');
    assert.match(ask.bot, /you pick/i);

    const offer = await c.say('you pick');
    assert.equal(c.memory.businessDescription, 'pizza shop');
    assert.equal(offer.node, 'salesUseCase');
    assert.ok(offer.listening);

    await c.say('all of them');
    assert.match(c.memory.useCaseText, /take orders, answer menu questions, and book catering/);
    const consent = await c.say('github');
    assert.equal(consent.node, 'salesConsent');
  });
});

describe('docs path', () => {
  it('a generic question asks what it is, then answers from the docs advisor', async () => {
    const docs = fakeDocs(() => 'Add a tool in the node listens.');
    const c = buildConversation({ docs });
    await c.say('');
    const ask = await c.say('I have a question about the vapi studio');
    assert.deepEqual(tagPayload(c, 'entry_intent_detected'), { intent: 'docs_question' });
    assert.equal(ask.node, 'docsAnswer');
    assert.match(ask.bot, /what's your question/i);
    assert.equal(docs.questions.length, 0);

    const a = await c.say('how do I add a tool?');
    assert.deepEqual(docs.questions.map((q) => q.question), ['how do I add a tool?']);
    assert.match(a.bot, /Add a tool in the node listens\./);
    assert.match(a.bot, /anything else about Studio/i);
    assert.ok(a.listening);
    assert.ok(tagNames(c).includes('docs_answer_given'));

    await c.say('where is the quick start?');
    assert.deepEqual(docs.questions[1].history, [
      { question: 'how do I add a tool?', answer: 'Add a tool in the node listens.' },
    ]);

    const end = await c.say("no, that's all");
    assert.ok(end.ended);
    assert.equal(end.node, 'docsEnd');
    assert.deepEqual(c.mail.sent, []);
  });

  it('a specific first question is answered right away', async () => {
    const docs = fakeDocs();
    const c = buildConversation({ docs });
    await c.say('');
    const r = await c.say('How do I add a tool to a node?');
    assert.deepEqual(docs.questions.map((q) => q.question), ['How do I add a tool to a node?']);
    assert.match(r.bot, /Let me check the Studio docs/);
    assert.ok(r.listening);
  });

  it('when the docs have no answer it says so and tells the team', async () => {
    const c = buildConversation({ docs: fakeDocs(() => null) });
    await c.say('');
    const r = await c.say('Does Studio support SIP trunking?');
    assert.match(r.bot, /anything else about Studio/i);
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['docs_unanswered']);
    assert.deepEqual(c.mail.sent[0].args, ['Does Studio support SIP trunking?']);
    assert.ok(tagNames(c).includes('docs_question_unanswered'));
  });

  it('switching to an issue after an answer moves to the issue path', async () => {
    const c = buildConversation();
    await c.say('');
    await c.say('How do I add a tool to a node?');
    const r = await c.say('my flow crashes after the extractor');
    assert.equal(r.node, 'supportDetail');
    assert.match(c.memory.supportIssue, /crashes after the extractor/);
  });
});

describe('issue path', () => {
  it('collects the issue and details, reports it to the team, then asks to follow up', async () => {
    const c = buildConversation();
    await c.say('');
    const ask = await c.say('I want to report a bug');
    assert.deepEqual(tagPayload(c, 'entry_intent_detected'), { intent: 'support' });
    assert.equal(ask.node, 'supportIssue');
    assert.match(ask.bot, /what's going wrong/i);

    const detail = await c.say('the extractor loops forever');
    assert.equal(detail.node, 'supportDetail');
    assert.match(detail.bot, /error message|version/i);
    assert.deepEqual(c.mail.sent, []);

    const consent = await c.say('version 0.1.1, no error shown');
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['issue_report']);
    const report = c.mail.sent[0].memory;
    assert.equal(report.supportIssue, 'the extractor loops forever');
    assert.equal(report.supportDetail, 'version 0.1.1, no error shown');
    assert.ok(tagNames(c).includes('issue_report_sent'));
    assert.equal(consent.node, 'supportConsent');
    assert.match(consent.bot, /sent that to the Vapi Studio team/i);
    assert.match(consent.bot, /get back to you/i);

    const end = await c.say('no');
    assert.ok(end.ended);
    assert.match(end.bot, /the team has your report/i);
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['issue_report']);
  });

  it('issue in the first line skips the "what’s wrong" question; yes asks how to reach them', async () => {
    const c = buildConversation();
    await c.say('');
    const detail = await c.say('My flow stops after the extractor.');
    assert.equal(detail.node, 'supportDetail');
    assert.equal(c.memory.supportIssue, 'My flow stops after the extractor.');

    await c.say("I don't know");
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['issue_report']);
    assert.equal(c.mail.sent[0].memory.supportDetail, undefined);

    const how = await c.say('yes');
    assert.equal(how.node, 'contactMethod');
    const end = await c.say('email');
    assert.ok(end.ended);
    assert.match(end.bot, /email you about it/i);
    assert.deepEqual(c.mail.sent.map((m) => m.kind), ['issue_report', 'demo:support_request']);
  });

  it('a question is never stored as the issue', async () => {
    const c = buildConversation();
    await c.say('');
    await c.say('I have a question');
    assert.equal(c.memory.supportIssue, undefined);
    assert.equal(c.runtime.currentNodeId, 'docsAnswer');
  });
});
