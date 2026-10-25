/**
 * Decision Brain drivers refuse to scan an intention without a description.
 * Every intention a scan can see (flow.yaml nodes + listen lists in the demo
 * nodes) must have one in config/flow.yaml `intentions`.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FlowLoader, STANDARD_INTENTION_DESCRIPTIONS } = require('@guidify-ai/vapi-studio');
const { PLANNER_INTENTIONS } = require(join(root, 'dist/conversation/planner-schema.js'));

it('every scannable intention has a description', () => {
  const loader = new FlowLoader();
  const flow = loader.loadFromFile(join(root, 'config/flow.yaml'));

  const names = new Set(Object.values(flow.nodes).flatMap((n) => n.intentions));
  const nodesSrc = readFileSync(
    join(root, 'src/conversation/nodes/planner/demo-conversation.nodes.ts'),
    'utf8',
  );
  for (const m of nodesSrc.matchAll(/PLANNER_INTENTIONS\.(\w+)/g)) {
    names.add(PLANNER_INTENTIONS[m[1]]);
  }

  const missing = [...names].filter(
    (name) =>
      !loader.intentionDescription(name) && !STANDARD_INTENTION_DESCRIPTIONS[name],
  );
  assert.deepEqual(missing, []);
});
