import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT, FAKE_QODO, makeRun, pageLog, readJson, run, tmp } from './helpers.mjs';

function exportRun(runDir, env = {}) {
  const log = join(tmp('log-'), 'pages.log');
  const res = run(EXPORT, ['--out', runDir, '--qodo', FAKE_QODO, ...(env.readArgs ? ['--read-args', env.readArgs] : [])], {
    env: { FAKE_LOG: log, FAKE_STATE: join(tmp('state-'), 'count'), ...env },
  });
  return { ...res, log: pageLog(log) };
}

test('happy export: 230 rules → 3 pages, 6 batches ordered by ruleId, last batch 30', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'exported');
  assert.equal(res.json.exported, 230);
  assert.equal(res.json.totalCount, 230);
  assert.equal(res.json.pages, 3);
  assert.equal(res.json.page_size, 100);
  assert.deepEqual(res.log, [[1, 100], [2, 100], [3, 100]]);
  const exp = readJson(join(runDir, 'export.json'));
  assert.equal(exp.rules.length, 230);
  assert.equal(exp.run_id, '20260101-000000');
  assert.ok(exp.exported_at);
  const files = readdirSync(join(runDir, 'batches')).sort();
  assert.equal(files.length, 12);
  assert.equal(files[10], 'batch-006.json');
  assert.equal(files[11], 'batch-006.txt');
  // the plain-text view a classifier reads: header line per rule, content verbatim, id trailer
  const view = readFileSync(join(runDir, 'batches', 'batch-001.txt'), 'utf8');
  assert.match(view, /^# run 20260101-000000 · batch 1 · 40 rules\n/);
  assert.match(view, /^=== 7 \| .* \| category=.* \| severity=.* \| guard=auth, authentic$/m);
  assert.match(view, /^=== 19 \| .* \| guard=-$/m);
  assert.match(view, /\nIDS=1,2,3,.*,40\n$/);
  const last = readJson(join(runDir, 'batches', 'batch-006.json'));
  assert.equal(last.rules.length, 30);
  const first = readJson(join(runDir, 'batches', 'batch-001.json'));
  assert.deepEqual(Object.keys(first.rules[0]), ['ruleId', 'name', 'category', 'severity', 'content', 'guard_hits']);
  assert.deepEqual(first.rules.map((r) => r.ruleId), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.deepEqual(first.rules.find((r) => r.ruleId === 7).guard_hits, ['auth', 'authentic']);
  assert.deepEqual(first.rules.find((r) => r.ruleId === 11).guard_hits, ['delete']);
  assert.deepEqual(first.rules.find((r) => r.ruleId === 13).guard_hits, ['personal data']);
  assert.deepEqual(first.rules.find((r) => r.ruleId === 19).guard_hits, []);
  assert.ok(!existsSync(join(runDir, 'export.json.tmp')));
});

test('second run in the same folder is a no-op (already_exported)', () => {
  const { runDir } = makeRun();
  assert.equal(exportRun(runDir).status, 0);
  const res = exportRun(runDir);
  assert.equal(res.status, 0);
  assert.equal(res.json.status, 'already_exported');
  assert.equal(res.json.batches, 6);
  assert.deepEqual(res.log, []);
});

test('export.json present but batches/ empty → exit 2 with re-export hint', () => {
  const { runDir } = makeRun();
  assert.equal(exportRun(runDir).status, 0);
  rmSync(join(runDir, 'batches'), { recursive: true });
  const res = exportRun(runDir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /remove export\.json to re-export/);
});

test('missing rubric snapshot → exit 2, nothing written', () => {
  const runDir = join(tmp(), 'run');
  mkdirSync(runDir);
  const res = exportRun(runDir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /rubric-snapshot\.yaml missing/);
  assert.ok(!existsSync(join(runDir, 'export.json')));
});

test('truncation on page 1 → halve to 50 and refetch from page 1', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'truncate_above:50' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.exported, 230);
  assert.equal(res.json.page_size, 50);
  assert.deepEqual(res.log, [[1, 100], [1, 50], [2, 50], [3, 50], [4, 50], [5, 50]]);
  assert.match(res.stderr, /truncated by the runtime/);
});

test('truncation on page 2 keeps the 100-rule prefix and resumes at page 3 of size 50', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'truncate_at:2:100' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.exported, 230);
  assert.deepEqual(res.log, [[1, 100], [2, 100], [3, 50], [4, 50], [5, 50]]);
  assert.match(res.stderr, /keeping 100 fetched rules and continuing at page 3 with page size 50/);
  const exp = readJson(join(runDir, 'export.json'));
  assert.deepEqual(new Set(exp.rules.map((r) => r.ruleId)).size, 230);
});

test('one rate limit → waits, retries once, succeeds', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'ratelimit:1' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.exported, 230);
  assert.match(res.stderr, /rate limited \(MT-RATE-LIMITED\); waiting 5s and retrying once/);
});

test('two consecutive rate limits → exit 2 and no files', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'ratelimit:2' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MT-RATE-LIMITED/);
  assert.match(res.stderr, /Nothing written/);
  assert.ok(!existsSync(join(runDir, 'export.json')));
  assert.ok(!existsSync(join(runDir, 'batches')));
});

test('rate limit reported only on stderr is still recognised', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'ratelimit_stderr:1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /rate limited/);
});

test('short page → count mismatch → exit 2, nothing written', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'short' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /fetched 135 rules but totalCount is 230/);
  assert.ok(!existsSync(join(runDir, 'export.json')));
  assert.ok(!existsSync(join(runDir, 'batches')));
});

test('empty workspace → export.json with zero rules, no batches, then already_exported', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_TOTAL: '0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.exported, 0);
  assert.equal(res.json.batches, 0);
  assert.equal(readJson(join(runDir, 'export.json')).rules.length, 0);
  assert.equal(readdirSync(join(runDir, 'batches')).length, 0);
  const again = exportRun(runDir, { FAKE_TOTAL: '0' });
  assert.equal(again.status, 0);
  assert.equal(again.json.status, 'already_exported');
});

test('literal null payload → invalid_json error, not a TypeError', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'null' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /invalid_json/);
  assert.doesNotMatch(res.stderr, /TypeError/);
});

test('noisy stdout (notice line before, trace after) still parses', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'noisy' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.exported, 230);
  assert.match(res.stderr, /QODO_NOTICE/);
});

test('totalCount drift mid-run → exit 2', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'drift' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /totalCount changed during paging \(230 → 231 on page 2\)/);
});

test('paging that does not advance → exit 2', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'stuck' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /paging is not advancing: 300 rules after page 3 exceeds totalCount 230/);
});

test('--read-args overrides the default read command; the default fails against a different catalog', () => {
  const a = makeRun();
  const bad = exportRun(a.runDir, { FAKE_READ_ARGS: 'rules list' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown_command/);
  const b = makeRun();
  const good = exportRun(b.runDir, { FAKE_READ_ARGS: 'rules list', readArgs: 'rules list' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.json.exported, 230);
});

test('failure message carries the launcher stderr tail', () => {
  const { runDir } = makeRun();
  const res = exportRun(runDir, { FAKE_MODE: 'ratelimit_stderr:2' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /stderr: MT-RATE-LIMITED: slow down/);
});

test('--guard-terms is no longer accepted', () => {
  const { runDir } = makeRun();
  const res = run(EXPORT, ['--out', runDir, '--qodo', FAKE_QODO, '--guard-terms', 'x']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown argument: --guard-terms/);
});

test('snapshot guard_terms_extra flow into guard_hits', () => {
  const { runDir } = makeRun('version: 1\nseverity_overrides: {}\nguard_terms_extra:\n  - "Rule 5"\n');
  const res = exportRun(runDir);
  assert.equal(res.status, 0, res.stderr);
  const first = readJson(join(runDir, 'batches', 'batch-001.json'));
  assert.deepEqual(first.rules.find((r) => r.ruleId === 5).guard_hits, ['Rule 5']);
  assert.ok(res.json.guard_terms.includes('Rule 5'));
  writeFileSync(join(runDir, 'marker'), '');
});
