import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, isHeld, latestByRule, readLedger } from '../lib/ledger-lib.mjs';
import {
  CALIB_DECISIONS, CALIB_PRECHECKED, CALIB_RULES, CALIB_TAGS,
  LEDGER, PROPOSAL, ledgerLines, makeCalibrated, readText, run,
} from './helpers.mjs';

const RENDERED = [...CALIB_PRECHECKED, ...CALIB_DECISIONS];

function entry(ruleId, decision, severity, { content = null, run_id = '20251201-000000' } = {}) {
  const rule = CALIB_RULES.find((r) => r.ruleId === ruleId);
  return {
    rule_id: ruleId, decision, severity_at_decision: severity,
    content_hash: contentHash(content ?? rule.content), run_id, decided_at: '2025-12-01T00:00:00.000Z',
  };
}

function proposed(entries = []) {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  if (entries.length) writeFileSync(ctx.ledger, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return ctx;
}

function render(ctx) {
  const res = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1', '--replace'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  return res.json;
}

test('--show on an empty ledger is a valid, empty answer', () => {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  const res = run(LEDGER, ['--show'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.ledger_path, ctx.ledger);
  assert.equal(res.json.rules, 0);
  assert.deepEqual(res.json.entries, []);
  const one = run(LEDGER, ['--show', '815399'], { env: ctx.env });
  assert.equal(one.status, 0);
  assert.deepEqual(one.json.no_entry, [815399]);
});

test('--show reports the latest entry per rule', () => {
  const ctx = proposed([entry(101, 'skip', 'error'), entry(102, 'skip', 'error'), entry(101, 'released', 'error')]);
  const res = run(LEDGER, ['--show'], { env: ctx.env });
  assert.equal(res.json.rules, 2);
  assert.deepEqual(res.json.entries.map((e) => [e.rule_id, e.decision]), [[101, 'released'], [102, 'skip']]);
  assert.equal(res.json.held_candidates, 1);
});

test('--reconsider releases a held rule and the next render proposes it again', () => {
  const ctx = proposed([entry(101, 'skip', 'error'), entry(102, 'skip', 'error')]);
  assert.equal(render(ctx).held_by_prior_decision, 2);
  const res = run(LEDGER, ['--reconsider', '101'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'released');
  assert.deepEqual(res.json.released, [101]);
  assert.deepEqual(res.json.nothing_to_release, []);
  const lines = ledgerLines(ctx.ledger);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].decision, 'released');
  assert.equal(lines[2].rule_id, 101);
  assert.equal(lines[2].run_id, '20251201-000000');
  const after = render(ctx);
  assert.equal(after.held_by_prior_decision, 1);
  assert.ok(readText(join(ctx.runDir, 'proposal.md')).includes(' 101 · '));
});

test('--reconsider on an unknown or already released id writes nothing and says so', () => {
  const ctx = proposed([entry(101, 'skip', 'error'), entry(101, 'released', 'error')]);
  const res = run(LEDGER, ['--reconsider', '101', '4242'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'nothing_to_release');
  assert.deepEqual(res.json.released, []);
  assert.deepEqual(res.json.nothing_to_release, [101, 4242]);
  assert.equal(ledgerLines(ctx.ledger).length, 2);
});

test('--reconsider releases several ids in one call and reports the rest', () => {
  const ctx = proposed([entry(101, 'skip', 'error'), entry(102, 'override', 'warning')]);
  const res = run(LEDGER, ['--reconsider', '101', '102', '999'], { env: ctx.env });
  assert.deepEqual(res.json.released, [101, 102]);
  assert.deepEqual(res.json.nothing_to_release, [999]);
  assert.equal(render(ctx).held_by_prior_decision, 0);
});

test('the ledger lives under QODO_HOME and usage errors are refused', () => {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  assert.equal(run(LEDGER, ['--show'], { env: ctx.env }).json.ledger_path, join(ctx.calibrate, 'decisions.jsonl'));
  assert.equal(run(LEDGER, ['--show', '--reconsider', '1'], { env: ctx.env }).status, 1);
  assert.equal(run(LEDGER, [], { env: ctx.env }).status, 1);
  assert.equal(run(LEDGER, ['--reconsider'], { env: ctx.env }).status, 1);
  assert.match(run(LEDGER, ['--bogus'], { env: ctx.env }).stderr, /unknown argument/);
  assert.ok(!existsSync(ctx.ledger));
});

test('hold semantics live in one place', () => {
  const rule = { content: 'the rule body' };
  const hash = contentHash('the rule body');
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(hash, contentHash('the rule body '));
  const row = { current: 'error' };
  assert.equal(isHeld(row, rule, undefined), false);
  assert.equal(isHeld(row, rule, { decision: 'skip', content_hash: hash }), true);
  assert.equal(isHeld(row, rule, { decision: 'override', content_hash: hash }), true);
  assert.equal(isHeld(row, rule, { decision: 'skip', content_hash: contentHash('edited') }), false);
  assert.equal(isHeld(row, null, { decision: 'skip', content_hash: hash }), false);
  assert.equal(isHeld(row, rule, { decision: 'approve', severity_at_decision: 'error' }), true);
  assert.equal(isHeld(row, rule, { decision: 'approve', severity_at_decision: 'warning' }), false);
  assert.equal(isHeld(row, rule, { decision: 'released', content_hash: hash }), false);
});

test('readLedger skips blank and corrupt lines and keeps append order', () => {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  writeFileSync(ctx.ledger, [
    JSON.stringify(entry(101, 'skip', 'error')),
    '',
    'not json at all',
    '{"rule_id": 101}',
    '[1,2,3]',
    JSON.stringify(entry(101, 'released', 'error')),
    '',
  ].join('\n'));
  const warnings = [];
  const entries = readLedger(ctx.ledger, (m) => warnings.push(m));
  assert.equal(entries.length, 2);
  assert.equal(warnings.length, 3);
  assert.equal(latestByRule(entries).get('101').decision, 'released');
  assert.equal(readLedger(join(ctx.calibrate, 'nope.jsonl'), () => {}).length, 0);
});
