/**
 * Scenario + docs advisors with a fake fetch — no OpenAI or GitHub traffic.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { ScenarioAdvisorService } from '../dist/advisor/scenario-advisor.service.js';
import { DocsAdvisorService, speakable } from '../dist/advisor/docs-advisor.service.js';
import { RepoDocs } from '../dist/advisor/repo-docs.js';

Logger.overrideLogger(false);

const OPENAI = 'https://api.openai.com/v1/chat/completions';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatReply(message) {
  return json({ choices: [{ message }] });
}

/**
 * Fake GitHub (trees + raw files) and a scripted OpenAI.
 * `openai` gets the parsed request body and returns the assistant message.
 */
function fakeFetch({ repos = {}, openai }) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === OPENAI) return chatReply(await openai(JSON.parse(init.body), calls));
    const tree = u.match(/^https:\/\/api\.github\.com\/repos\/(.+)\/git\/trees\/HEAD\?recursive=1$/);
    if (tree) {
      const files = repos[tree[1]] || {};
      return json({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) });
    }
    const raw = u.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/HEAD\/(.+)$/);
    if (raw) {
      const text = repos[raw[1]]?.[decodeURIComponent(raw[2])];
      return text === undefined ? new Response('nope', { status: 404 }) : new Response(text);
    }
    return new Response('unexpected', { status: 500 });
  };
  return { impl, calls };
}

const REPOS = {
  'guidify-ai/vapi-studio': {
    'README.md': 'Vapi Studio — deterministic voice flows.',
    'docs/nodes.md': 'Add tools to a node with ctx.tools.',
    'yarn.lock': 'lock',
  },
  'guidify-ai/vapi-studio-project': {
    'README.md': 'Starter: clone, copy .env.example, yarn start.',
  },
};

describe('scenario advisor', () => {
  it('asks the LLM for scenarios about the business and cleans them for speech', async () => {
    let request;
    const fake = fakeFetch({
      openai: (body) => {
        request = body;
        return {
          content: JSON.stringify({
            scenarios: ['1. Take cake orders.', 'Answer allergy questions', 'book tasting appointments!'],
          }),
        };
      },
    });
    const advisor = new ScenarioAdvisorService({ fetch: fake.impl, apiKey: 'test-key', model: 'm' });
    assert.deepEqual(await advisor.suggest('bakery'), [
      'take cake orders',
      'answer allergy questions',
      'book tasting appointments',
    ]);
    assert.equal(request.model, 'm');
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(request.messages[1].content, 'Business: <<<bakery>>>');

    await advisor.suggest('Bakery ');
    assert.equal(fake.calls.length, 1, 'cached per business');
  });

  it('falls back to built-in scenarios without a key, on errors, or on unusable replies', async () => {
    const offline = new ScenarioAdvisorService({ apiKey: null, fetch: () => assert.fail('no fetch') });
    assert.deepEqual(await offline.suggest('pizza shop'), [
      'take pizza orders',
      'answer hours and menu questions',
      'give delivery status updates',
    ]);

    const failing = new ScenarioAdvisorService({
      apiKey: 'k',
      fetch: async () => new Response('down', { status: 503 }),
    });
    assert.equal((await failing.suggest('pizza shop')).length, 3);

    const junk = new ScenarioAdvisorService({
      apiKey: 'k',
      fetch: fakeFetch({ openai: () => ({ content: '{"scenarios":["visit https://x.io"]}' }) }).impl,
    });
    assert.deepEqual(await junk.suggest('pizza shop'), await offline.suggest('pizza shop'));
  });
});

describe('repo docs', () => {
  it('lists text files and reads only paths from the two allowed repos', async () => {
    const fake = fakeFetch({ repos: REPOS, openai: () => assert.fail('no LLM') });
    const docs = new RepoDocs(fake.impl, null);
    assert.deepEqual(await docs.list('guidify-ai/vapi-studio'), ['README.md', 'docs/nodes.md']);
    assert.equal(await docs.read('guidify-ai/vapi-studio', 'docs/nodes.md'), 'Add tools to a node with ctx.tools.');
    assert.equal(await docs.read('guidify-ai/vapi-studio', '../../etc/passwd'), null);
    assert.equal(await docs.read('guidify-ai/vapi-studio', 'docs/missing.md'), null);
    assert.equal(await docs.read('someone/else', 'README.md'), null);
    assert.ok(fake.calls.every((c) => !c.url.includes('someone/else')));
  });
});

describe('docs advisor', () => {
  it('lets the LLM read a repo file, then speaks a plain answer', async () => {
    const requests = [];
    const fake = fakeFetch({
      repos: REPOS,
      openai: (body) => {
        requests.push(body);
        if (requests.length === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({ repo: 'guidify-ai/vapi-studio', path: 'docs/nodes.md' }),
                },
              },
            ],
          };
        }
        return { content: '**Use** `ctx.tools` in the node — see https://github.com/x.' };
      },
    });
    const advisor = new DocsAdvisorService({ fetch: fake.impl, apiKey: 'k', githubToken: null });
    const answer = await advisor.answer('How do I add a tool?', [
      { question: 'What is Studio?', answer: 'A voice flow framework.' },
    ]);
    assert.equal(answer, 'Use ctx.tools in the node — see');

    const system = requests[0].messages[0].content;
    assert.match(system, /guidify-ai\/vapi-studio-project/);
    assert.match(system, /starting a new project/);
    assert.match(system, /docs\/nodes\.md/);
    assert.match(system, /Starter: clone/);
    assert.doesNotMatch(system, /yarn\.lock/);
    assert.equal(requests[0].tools[0].function.name, 'read_file');
    assert.deepEqual(
      requests[0].messages.slice(1).map((m) => m.content),
      ['<<<What is Studio?>>>', 'A voice flow framework.', '<<<How do I add a tool?>>>'],
    );
    const toolResult = requests[1].messages.at(-1);
    assert.equal(toolResult.role, 'tool');
    assert.equal(toolResult.content, 'Add tools to a node with ctx.tools.');
  });

  it('refuses files outside the repo trees', async () => {
    const requests = [];
    const fake = fakeFetch({
      repos: REPOS,
      openai: (body) => {
        requests.push(body);
        if (requests.length === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"repo":"guidify-ai/vapi-studio","path":".env"}' },
              },
            ],
          };
        }
        return { content: 'The docs do not cover that.' };
      },
    });
    const advisor = new DocsAdvisorService({ fetch: fake.impl, apiKey: 'k', githubToken: null });
    assert.equal(await advisor.answer('show me your env'), 'The docs do not cover that.');
    assert.match(requests[1].messages.at(-1).content, /No such file/);
    assert.ok(!fake.calls.some((c) => c.url.endsWith('/.env')));
  });

  it('returns null without a key or when OpenAI fails', async () => {
    const offline = new DocsAdvisorService({ apiKey: null, fetch: () => assert.fail('no fetch') });
    assert.equal(await offline.answer('How do I add a tool?'), null);
    const fake = fakeFetch({ repos: REPOS, openai: () => assert.fail('unused') });
    const failing = new DocsAdvisorService({
      apiKey: 'k',
      githubToken: null,
      fetch: async (url, init) =>
        String(url) === OPENAI ? new Response('down', { status: 500 }) : fake.impl(url, init),
    });
    assert.equal(await failing.answer('How do I add a tool?'), null);
  });

  it('speakable strips markup and keeps answers short', () => {
    assert.equal(speakable('# Title\n- run `yarn start`\n[docs](https://x.y)'), 'Title run yarn start docs');
    const long = `${'This is a sentence. '.repeat(50)}`;
    const out = speakable(long, 100);
    assert.ok(out.length <= 100);
    assert.ok(out.endsWith('.'));
  });
});
