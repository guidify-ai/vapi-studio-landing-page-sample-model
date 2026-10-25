import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildDesignPackage } from '../dist/conversation/lib/build-design-package.js';
import { PLANNER_FUNNELS, PLANNER_ANALYTICS_TAGS } from '../dist/analytics/planner-funnels.js';
import {
  detectEntryIntent,
  extractVolunteeredFacts,
  extractPhoneDigits,
} from '../dist/conversation/lib/demo-understanding.js';

describe('planner design package', () => {
  it('builds sample + funnels fail-closed', () => {
    const draft = buildDesignPackage({
      companyName: 'Acme HVAC',
      companyDoes: 'fixes heating and cooling',
      useCase: 'qualify',
      discoveryAnswers: ['name and callback', 'angry callers transfer'],
      integrationInterest: 'none',
    });
    assert.ok(draft.sampleConversation.includes('Acme HVAC'));
    assert.ok(draft.flowNodes.length >= 4);
    assert.ok(draft.funnels.length >= 1);
    assert.ok(draft.analyticsEvents.includes('call_started'));
  });
});

describe('landing demo analytics catalog', () => {
  it('exposes landing voice demo funnel milestones', () => {
    assert.equal(PLANNER_FUNNELS[0].id, 'landing_voice_demo');
    const tags = PLANNER_FUNNELS[0].steps.flatMap((s) => s.tags || []);
    assert.ok(tags.includes(PLANNER_ANALYTICS_TAGS.demoStarted));
    assert.ok(tags.includes(PLANNER_ANALYTICS_TAGS.salesLeadCreated));
    assert.ok(tags.includes(PLANNER_ANALYTICS_TAGS.demoCompleted));
  });
});

describe('landing demo flow.yaml', () => {
  it('starts at greet with project/docs/issue/feature graph', async () => {
    const { readFileSync } = await import('node:fs');
    const yaml = readFileSync(join(process.cwd(), 'config/flow.yaml'), 'utf8');
    assert.match(yaml, /id:\s*sample-landing-demo/);
    assert.match(yaml, /start:\s*greet/);
    assert.match(yaml, /class:\s*DemoGreetNode/);
    assert.match(yaml, /class:\s*DemoSalesConsentNode/);
    assert.match(yaml, /class:\s*DemoSupportIssueNode/);
    assert.match(yaml, /class:\s*DemoFeatureConsentNode/);
    assert.match(yaml, /class:\s*DemoSupportDetailNode/);
    assert.match(yaml, /class:\s*DemoDocsAnswerNode/);
    assert.match(yaml, /class:\s*DemoDocsEndNode/);
    assert.doesNotMatch(yaml, /DemoExplorer/, 'exploring shares the project nodes');
    assert.doesNotMatch(yaml, /PhoneDemoWhatNode|RoofEstimate|routerTriage/);
  });
});

describe('demo understanding heuristics', () => {
  it('detects entry intents', () => {
    assert.equal(
      detectEntryIntent('My flow stops after the extractor.'),
      'support',
    );
    assert.equal(
      detectEntryIntent('You should support parallel extractors.'),
      'feature_request',
    );
    assert.equal(
      detectEntryIntent(
        'We have a property management company and want to replace our answering service.',
      ),
      'sales_or_use_case',
    );
    assert.equal(detectEntryIntent('Just playing with the demo.'), 'exploring');
    assert.equal(
      detectEntryIntent('wanna explore vapi studio'),
      'exploring',
    );
    assert.equal(
      detectEntryIntent('Want to explore what you are'),
      'exploring',
    );
    assert.equal(
      detectEntryIntent('explorin business idea'),
      'sales_or_use_case',
    );
    assert.equal(
      detectEntryIntent('table QR code for cafe'),
      'sales_or_use_case',
    );
  });

  it('questions and docs help about Studio go to the docs path, not sales or issues', () => {
    for (const line of [
      'I have a question about the vapi studio',
      'I have a question',
      'quick question about Studio',
      'Where are the docs?',
      'I need some help with the documentation',
      'How do I add a tool to a node?',
      'can you help me set up my first flow',
      'We have a question about extractors',
    ]) {
      assert.equal(detectEntryIntent(line), 'docs_question', line);
    }
    for (const line of [
      'My flow stops after the extractor.',
      'I want to report a bug',
      'the studio editor crashes when I save',
      'I have a problem with the extractor node',
    ]) {
      assert.equal(detectEntryIntent(line), 'support', line);
    }
    assert.equal(
      detectEntryIntent('I have a question about using it for my dental clinic'),
      'sales_or_use_case',
      'a question about a business is still a project',
    );
    assert.equal(detectEntryIntent('I have a pizza shop'), 'sales_or_use_case');
    assert.equal(detectEntryIntent('Just playing with the demo.'), 'exploring');
  });

  it('extracts multi-facts from one utterance', () => {
    const memory = {};
    extractVolunteeredFacts(
      'We run a dental clinic and want Vapi to handle appointment booking. I found Studio on GitHub.',
      memory,
    );
    assert.match(String(memory.businessDescription || ''), /dental/i);
    assert.match(String(memory.useCaseText || ''), /appointment/i);
    assert.match(String(memory.discoverySource || ''), /GitHub/i);
  });

  it('extracts cafe + QR from a short line', () => {
    const memory = {};
    extractVolunteeredFacts('table QR code for cafe', memory);
    assert.match(String(memory.businessDescription || ''), /cafe/i);
    assert.match(String(memory.useCaseText || ''), /qr/i);
  });

  it('offers 2-3 caller-assistant scenarios per business', async () => {
    const { classifyBusiness, scenariosForKind, fallbackScenarios, scenarioOfferAsk } =
      await import('../dist/conversation/lib/demo-understanding.js');
    assert.equal(classifyBusiness('dodo'), 'unknown');
    assert.equal(classifyBusiness('pizza shop'), 'pizza');
    assert.deepEqual(scenariosForKind('pizza'), [
      'take pizza orders',
      'answer hours and menu questions',
      'give delivery status updates',
    ]);
    for (const business of ['pizza shop', 'dental clinic', 'online toy store', 'saas app', 'dodo', '']) {
      const options = fallbackScenarios(business);
      assert.ok(options.length >= 2 && options.length <= 3, business);
    }
    assert.match(fallbackScenarios('online toy store').join(' '), /product questions/);
    assert.equal(
      scenarioOfferAsk('pizza shop', ['take orders', 'answer menu questions', 'book catering']),
      'A Studio phone assistant for a pizza shop could take orders, answer menu questions, or book catering. Which one fits best — or is it something else?',
    );
    assert.match(scenarioOfferAsk('', ['a', 'b']), /^A Studio phone assistant for your business could a, or b\./);
  });

  it('maps the caller reply to an offered scenario', async () => {
    const { pickScenario } = await import('../dist/conversation/lib/demo-understanding.js');
    const options = ['take pizza orders', 'answer hours and menu questions', 'give delivery status updates'];
    assert.deepEqual(pickScenario('the second one', options), {
      choice: options[1],
      index: 1,
      own: false,
    });
    assert.equal(pickScenario('third', options).index, 2);
    assert.equal(pickScenario('orders mostly', options).index, 0);
    assert.equal(pickScenario('delivery status', options).index, 2);
    const all = pickScenario('all of them', options);
    assert.equal(all.index, null);
    assert.match(all.choice, /take pizza orders.*menu questions.*delivery status/);
    const own = pickScenario('screen job applicants', options);
    assert.equal(own.own, true);
    assert.equal(own.choice, 'screen job applicants');
    assert.equal(pickScenario('   ', options), null);
  });

  it('pulls the docs question and the issue out of the first line', async () => {
    const { docsQuestionFrom, issueFrom } = await import('../dist/conversation/lib/demo-understanding.js');
    assert.equal(docsQuestionFrom('I have a question'), null);
    assert.equal(docsQuestionFrom('I have a question about the vapi studio'), null);
    assert.equal(docsQuestionFrom('How do I add a tool to a node?'), 'How do I add a tool to a node?');
    assert.equal(issueFrom('I want to report a bug'), null);
    assert.match(String(issueFrom('My flow stops after the extractor.')), /extractor/);
  });

  it('parses phone digits', () => {
    assert.equal(extractPhoneDigits('555-010-0999'), '+15550100999');
  });
});
