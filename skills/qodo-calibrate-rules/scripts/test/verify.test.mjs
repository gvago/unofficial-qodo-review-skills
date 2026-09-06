import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../lib/receipt-lib.mjs';
import {
  APPLY, FAKE_QODO, VERIFY,
  applyResults, confirmed, readText, receiptApplyStates, receiptFrontmatter, receiptStatuses,
  run, runScript, seedWorkspace, workspaceFile,
} from './helpers.mjs';

const FAST = { CALIBRATE_BACKOFF_MS: '1', CALIBRATE_TEST_MODE: '1' };
const uncheck = (line) => line.replace('- [x] ', '- [ ] ');
const retarget = (to) => (line) => line.replace(/→ \S+/, `→ ${to}`);

// The severities the workspace holds before the run: the CALIB rules' `current` column. The fake
// launcher's `rules list` overlays this file, so a rule nothing wrote to reads back unchanged.
const CURRENT = { 99: 'error', 101: 'error', 102: 'error', 103: 'warning', 104: 'warning', 105: 'warning', 106: 'warning', 107: 'error', 108: 'warning' };
const TARGET = { 99: 'recommendation', 101: 'recommendation', 102: 'recommendation', 103: 'recommendation', 104: 'error' };

// A confirmed run, applied against the fake workspace. `mode` is the fake's FAKE_UPDATE_MODE.
function applied({ mode = 'ok', edits = [] } = {}) {
  const ctx = confirmed({ edits });
  ctx.workspace = seedWorkspace(ctx, CURRENT);
  ctx.log = join(ctx.runDir, 'update-log.jsonl');
  ctx.state = join(ctx.runDir, 'fake-state.json');
  const g = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(g.status, 0, g.stderr);
  ctx.generate = g.json;
  ctx.apply = runScript(ctx, {
    FAKE_UPDATE_MODE: mode, FAKE_UPDATE_LOG: ctx.log, FAKE_STATE: ctx.state, FAKE_WORKSPACE: ctx.workspace, ...FAST,
  });
  return ctx;
}

function verify(ctx, env = {}) {
  return run(VERIFY, ['--run', ctx.runDir, '--qodo', FAKE_QODO], {
    env: { ...ctx.env, FAKE_WORKSPACE: ctx.workspace, FAKE_TOTAL: '110', ...env },
  });
}

const statusFor = (ctx, id) => new Map(receiptStatuses(ctx.runDir)).get(id);
const stateFor = (ctx, id) => new Map(receiptApplyStates(ctx.runDir)).get(id);
const verifyResults = (ctx) => applyResults(ctx.runDir).filter((r) => r.phase === 'verify');
const tokensFor = (ctx, id) => readText(join(ctx.runDir, 'receipt.md')).split('\n').find((l) => l.startsWith(`- [`) && l.includes(` ${id} · `));

// ---------------------------------------------------------------------------------------
// Clean verify

test('a clean verify tokens every applied row and exits 0', () => {
  // Uncheck 102 and 103: three approve rows are applied, and the two unchecked ones are skips.
  const ctx = applied({ edits: [['- [x] 102 ', uncheck], ['- [x] 103 ', uncheck]] });
  assert.equal(ctx.apply.status, 0, ctx.apply.stderr);
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'verified');
  assert.equal(res.json.counts.checked, 3);
  assert.equal(res.json.counts.verified, 3);
  assert.equal(res.json.counts.mismatch, 0);
  assert.deepEqual(res.json.mismatches, []);
  assert.equal(res.json.counts.active_rules, 110);
  for (const id of [99, 101, 104]) assert.equal(statusFor(ctx, id), 'verified', `row ${id}`);
  // The apply state survives the verify token, which is what keeps the grammar readable.
  for (const id of [99, 101, 104]) assert.equal(stateFor(ctx, id), 'applied', `apply state ${id}`);
  // Frontmatter records the read, and the verify results carry the comparison.
  const fm = receiptFrontmatter(ctx.runDir);
  assert.match(String(fm.verified_at), /^\d{4}-\d\d-\d\dT/);
  assert.equal(String(fm.verify_mismatches), '0');
  assert.equal(verifyResults(ctx).length, 3);
  assert.deepEqual(verifyResults(ctx).map((r) => [r.rule_id, r.status, r.expected, r.actual]).sort(), [
    [99, 'verified', 'recommendation', 'recommendation'],
    [101, 'verified', 'recommendation', 'recommendation'],
    [104, 'verified', 'error', 'error'],
  ].sort());
});

test('verify reads the whole active set by paging, never per rule', () => {
  const ctx = applied();
  const pages = join(ctx.runDir, 'pages.log');
  const res = verify(ctx, { FAKE_LOG: pages });
  assert.equal(res.status, 0, res.stderr);
  const calls = readFileSync(pages, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => [c.page, c.size]), [[1, 100], [2, 100]]);
  assert.equal(res.json.pages, 2);
  assert.equal(res.json.page_size, 100);
});

// ---------------------------------------------------------------------------------------
// Mismatches

test('a row the workspace drifted away from is a mismatch with the live severity', () => {
  const ctx = applied();
  // Someone edited rule 101 in the portal after the apply.
  writeFileSync(ctx.workspace, JSON.stringify({ ...CURRENT, ...TARGET, 101: 'warning' }));
  const res = verify(ctx);
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.status, 'mismatched');
  assert.equal(res.json.counts.mismatch, 1);
  assert.deepEqual(res.json.mismatches, [{
    rule_id: 101, apply_status: 'applied', apply_token: 'applied', expected: 'recommendation', actual: 'warning', landed_despite_failure: false,
  }]);
  assert.equal(statusFor(ctx, 101), 'mismatch(warning)');
  assert.match(tokensFor(ctx, 101), /· applied · mismatch\(warning\)$/);
  assert.match(res.stderr, /rule 101 applied — expected "recommendation", workspace holds "warning"/);
  // Every other row is still verified.
  assert.equal(res.json.counts.verified, 4);
});

test('a failed row whose write landed anyway is a mismatch, and says so', () => {
  // exit1_at prints the success body and exits 1: the receipt records failed(non_zero_exit) while
  // the workspace took the write.
  const ctx = applied({ mode: 'exit1_at:103' });
  assert.equal(statusFor(ctx, 103), 'failed(non_zero_exit)');
  const res = verify(ctx);
  assert.equal(res.status, EXIT.report);
  assert.deepEqual(res.json.mismatches, [{
    rule_id: 103, apply_status: 'failed', apply_token: 'failed(non_zero_exit)', expected: 'warning', actual: 'recommendation', landed_despite_failure: true,
  }]);
  assert.match(tokensFor(ctx, 103), /· failed\(non_zero_exit\) · mismatch\(recommendation\)$/);
  assert.match(res.stderr, /the write landed despite the reported failure/);
  // The apply state is untouched: the row still reads as failed, not applied.
  assert.equal(stateFor(ctx, 103), 'failed');
});

test('a failed row that did not land verifies against current', () => {
  const ctx = applied({ mode: 'fail:103:MT-VALIDATION' });
  assert.equal(statusFor(ctx, 103), 'failed(MT-VALIDATION)');
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.counts.checked, 5);
  assert.equal(res.json.counts.verified, 5);
  assert.match(tokensFor(ctx, 103), /· failed\(MT-VALIDATION\) · verified$/);
  assert.equal(stateFor(ctx, 103), 'failed');
});

test('an applied row that carried no severity is compared like any other', () => {
  // nosev_at: the response never named the severity, so `applied` is a claim — verify settles it.
  const ctx = applied({ mode: 'nosev_at:104' });
  assert.equal(statusFor(ctx, 104), 'applied');
  assert.equal(applyResults(ctx.runDir).find((r) => r.rule_id === 104).severity_verified, false);
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(verifyResults(ctx).find((r) => r.rule_id === 104).status, 'verified');
});

test('a rule that is gone from the workspace is mismatch(missing)', () => {
  const ctx = applied();
  const res = verify(ctx, { FAKE_DELETED: '101' });
  assert.equal(res.status, EXIT.report);
  assert.deepEqual(res.json.mismatches, [{
    rule_id: 101, apply_status: 'applied', apply_token: 'applied', expected: 'recommendation', actual: 'missing', landed_despite_failure: false,
  }]);
  assert.equal(statusFor(ctx, 101), 'mismatch(missing)');
  assert.equal(res.json.counts.active_rules, 109);
});

// ---------------------------------------------------------------------------------------
// Rows verify never touches

test('skipped, deferred and invalid rows are never read against', () => {
  const ctx = applied({ edits: [['- [x] 104 ', uncheck], ['- [x] 102 ', retarget('critical')]] });
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  // 99, 101, 103 approved; 104 skipped; 102 an invalid override; 105/106 still `[?]`.
  assert.equal(res.json.counts.checked, 3);
  assert.deepEqual(res.json.mismatches, []);
  assert.equal(statusFor(ctx, 104), 'skipped');
  for (const id of [102, 105, 106]) assert.equal(statusFor(ctx, id), 'pending', `row ${id} untouched`);
  assert.deepEqual(verifyResults(ctx).map((r) => r.rule_id).sort((a, b) => a - b), [99, 101, 103]);
});

// ---------------------------------------------------------------------------------------
// Refusals

test('a re-read that fails is exit 2 with the receipt untouched', () => {
  const ctx = applied();
  const before = readText(join(ctx.runDir, 'receipt.md'));
  const res = verify(ctx, { FAKE_MODE: 'truncate_above:5' });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /still truncated at page size 12 and the minimum is 10/);
  assert.match(res.stderr, /The receipt is unchanged and no result was recorded/);
  assert.equal(readText(join(ctx.runDir, 'receipt.md')), before);
  assert.equal(verifyResults(ctx).length, 0);
});

test('a missing receipt and a receipt from another run both refuse', () => {
  const ctx = confirmed();
  ctx.workspace = seedWorkspace(ctx, CURRENT);
  const missing = verify(ctx);
  assert.equal(missing.status, EXIT.refused);
  assert.match(missing.stderr, /receipt\.md missing/);

  const ok = applied();
  const receipt = join(ok.runDir, 'receipt.md');
  writeFileSync(receipt, readText(receipt).replace(/^run_id: .*$/m, 'run_id: 19990101-000000'));
  const wrong = verify(ok);
  assert.equal(wrong.status, EXIT.refused);
  assert.match(wrong.stderr, /does not match the run folder/);
});

test('--run is required and an unknown argument is a usage error', () => {
  const noRun = run(VERIFY, ['--qodo', FAKE_QODO]);
  assert.equal(noRun.status, EXIT.usage);
  assert.match(noRun.stderr, /--run <run-dir> is required/);
  const bad = run(VERIFY, ['--run', '/tmp', '--nope']);
  assert.equal(bad.status, EXIT.usage);
  assert.match(bad.stderr, /unknown argument: --nope/);
});

// ---------------------------------------------------------------------------------------
// Idempotence

test('verifying twice appends results and changes no token', () => {
  const ctx = applied();
  const first = verify(ctx);
  assert.equal(first.status, 0, first.stderr);
  const tokens = receiptStatuses(ctx.runDir);
  const second = verify(ctx);
  assert.equal(second.status, first.status);
  assert.deepEqual(second.json.counts, first.json.counts);
  assert.deepEqual(receiptStatuses(ctx.runDir), tokens);
  assert.equal(verifyResults(ctx).length, 10); // 5 rows, twice
});

test('a verify token changes only when the outcome changed', () => {
  const ctx = applied();
  assert.equal(verify(ctx).status, 0);
  assert.equal(statusFor(ctx, 101), 'verified');
  writeFileSync(ctx.workspace, JSON.stringify({ ...CURRENT, ...TARGET, 101: 'warning' }));
  const drifted = verify(ctx);
  assert.equal(drifted.status, EXIT.report);
  assert.match(tokensFor(ctx, 101), /· applied · verified · mismatch\(warning\)$/);
});

// ---------------------------------------------------------------------------------------
// The token/state grammar the report is built on

test('apply state is the last apply-class token, and failed(revert:…) still reads as applied', async () => {
  const { applyState, applyToken, isRevertCandidate, verifyState } = await import('../lib/receipt-lib.mjs');
  const cases = [
    [[], 'pending', null],
    [['applied'], 'applied', null],
    [['applied', 'verified'], 'applied', 'verified'],
    [['failed(non_zero_exit)', 'mismatch(error)'], 'failed', 'mismatch(error)'],
    [['applied', 'failed(revert:MT-VALIDATION)'], 'applied', null],
    [['applied', 'verified', 'reverted'], 'reverted', 'verified'],
    [['skipped'], 'skipped', null],
    [['deferred'], 'deferred', null],
  ];
  for (const [statuses, state, verifyToken] of cases) {
    assert.equal(applyState(statuses), state, `applyState ${statuses.join(' · ')}`);
    assert.equal(verifyState(statuses), verifyToken, `verifyState ${statuses.join(' · ')}`);
  }
  assert.equal(applyToken(['applied', 'verified']), 'applied');
  assert.equal(applyToken([]), null);
  // Revert selects the rows believed to sit at the target, and never one already reverted.
  assert.equal(isRevertCandidate({ statuses: ['applied'], current: 'error' }), true);
  assert.equal(isRevertCandidate({ statuses: ['applied', 'failed(revert:MT-VALIDATION)'], current: 'error' }), true);
  assert.equal(isRevertCandidate({ statuses: ['applied', 'verified', 'reverted'], current: 'error' }), false);
  assert.equal(isRevertCandidate({ statuses: ['failed(non_zero_exit)', 'mismatch(error)'], current: 'warning' }), true);
  assert.equal(isRevertCandidate({ statuses: ['failed(MT-VALIDATION)', 'verified'], current: 'warning' }), false);
  // A rule that is gone from the active set is never a candidate: there is nothing to write to.
  assert.equal(isRevertCandidate({ statuses: ['applied', 'mismatch(missing)'], current: 'error' }), false);
  assert.equal(isRevertCandidate({ statuses: ['skipped'], current: 'error' }), false);
  assert.equal(isRevertCandidate({ statuses: [], current: 'error' }), false);
});

// ---------------------------------------------------------------------------------------
// Findings from the code review of this phase

test('a present but unusable live severity is mismatch(unknown), and the row still parses', () => {
  const ctx = applied();
  // A blank severity, and one carrying characters that would break the token grammar.
  writeFileSync(ctx.workspace, JSON.stringify({ ...CURRENT, ...TARGET, 101: '', 102: 'warn)ing · x' }));
  const res = verify(ctx);
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.counts.mismatch, 2);
  for (const id of [101, 102]) {
    assert.equal(res.json.mismatches.find((m) => m.rule_id === id).actual, 'unknown', `rule ${id}`);
    assert.equal(statusFor(ctx, id), 'mismatch(unknown)');
  }
  // The receipt still parses: every row's tokens strip cleanly, so a re-fold is a no-op.
  const before = receiptStatuses(ctx.runDir);
  assert.equal(verify(ctx).status, EXIT.report);
  assert.deepEqual(receiptStatuses(ctx.runDir), before);
});

test('zero rows in scope is nothing_to_verify, not a clean verify', () => {
  // Every approved row unchecked before the apply: the receipt has no row to read against.
  const ctx = applied({ edits: [['- [x] 99 ', uncheck], ['- [x] 101 ', uncheck], ['- [x] 102 ', uncheck], ['- [x] 103 ', uncheck], ['- [x] 104 ', uncheck]] });
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'nothing_to_verify');
  assert.equal(res.json.counts.checked, 0);
  assert.equal(res.json.counts.verified, 0);
});

test('a row unchecked in receipt.md after a successful apply is named, not silently dropped', () => {
  // The uncovered case: the admin edits *the receipt* after the apply. The row keeps its
  // `· applied` token, but the readback now calls it a skip — so it leaves verify's scope while
  // the rule is still sitting at the target.
  const ctx = applied();
  writeFileSync(ctx.receipt, readText(ctx.receipt).split('\n').map((l) => (l.startsWith('- [x] 101 ') ? uncheck(l) : l)).join('\n'));
  const res = verify(ctx);
  assert.equal(res.json.counts.checked, 4);
  assert.equal(res.json.counts.out_of_scope, 3); // 101 plus the two `[?]` rows
  const row = res.json.out_of_scope.find((r) => r.rule_id === 101);
  assert.deepEqual(row, {
    rule_id: 101, reason: 'unchecked in the checklist', decision: 'skip',
    apply_status: 'applied', apply_token: 'applied', changed_by_apply: true,
  });
  // And it is said out loud, because nothing in the counts would reveal it.
  assert.match(res.stderr, /rule 101 is not compared \(unchecked in the checklist\).*still at the target/);
  assert.ok(res.json.warnings.some((w) => w.includes('rule 101')));
  // The two `[?]` rows were never applied, so they carry no such warning.
  for (const id of [105, 106]) assert.equal(res.json.out_of_scope.find((r) => r.rule_id === id).changed_by_apply, false);
});

test('the out-of-scope list is capped, but never drops a row the apply changed', () => {
  // A real run produced 662 out-of-scope rows: listing them all turned the report the
  // orchestrator reads into 87 KB of JSON. Ordinary rows are capped; a `changed_by_apply` row is
  // the one an admin must not miss, so it is listed however long the list is.
  const ctx = applied();
  writeFileSync(ctx.receipt, readText(ctx.receipt).split('\n').map((l) => (l.startsWith('- [x] 101 ') ? uncheck(l) : l)).join('\n'));
  const res = verify(ctx, { CALIBRATE_TEST_MODE: '1', CALIBRATE_OUT_OF_SCOPE_CAP: '1' });
  assert.equal(res.json.counts.out_of_scope, 3, 'the count is always the true total');
  assert.equal(res.json.out_of_scope.length, 2, 'the changed row plus one ordinary row');
  assert.equal(res.json.out_of_scope_omitted, 1);
  const listed = res.json.out_of_scope.map((r) => r.rule_id);
  assert.ok(listed.includes(101), 'the changed_by_apply row survives the cap');
  assert.equal(res.json.out_of_scope.filter((r) => r.changed_by_apply).length, 1);
  // The warning is driven by the full set, not the truncated list.
  assert.ok(res.json.warnings.some((w) => w.includes('rule 101')));
  // Without the cap every row is listed and nothing is omitted.
  const full = verify(ctx);
  assert.equal(full.json.out_of_scope.length, 3);
  assert.equal(full.json.out_of_scope_omitted, 0);
});

test('a duplicate ruleId across pages is refused with nothing written', () => {
  const ctx = applied();
  const before = readText(ctx.receipt);
  const res = verify(ctx, { FAKE_MODE: 'dupe' });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /duplicate ruleId 1 across pages/);
  assert.match(res.stderr, /The receipt is unchanged and no result was recorded/);
  assert.equal(readText(ctx.receipt), before);
  assert.equal(verifyResults(ctx).length, 0);
});

test('the landed-despite-failure line fires only for a failed row sitting at its target', () => {
  // A pending row that drifted is a mismatch, but nothing about it says a write landed.
  const ctx = applied({ mode: 'auth_at:99' }); // aborts on the first row: every row stays pending
  writeFileSync(ctx.workspace, JSON.stringify({ ...CURRENT, 101: 'recommendation' }));
  const res = verify(ctx);
  assert.equal(res.status, EXIT.report);
  const m = res.json.mismatches.find((r) => r.rule_id === 101);
  assert.equal(m.apply_status, 'pending');
  assert.equal(m.landed_despite_failure, false);
  assert.doesNotMatch(res.stderr, /landed despite/);
});

test('apply --write-receipt ignores verify results for its counts and its applied_at', () => {
  const ctx = applied();
  const applyTimes = applyResults(ctx.runDir).filter((r) => (r.phase ?? 'apply') === 'apply').map((r) => r.at).sort();
  const lastApplyAt = applyTimes[applyTimes.length - 1];
  assert.equal(receiptFrontmatter(ctx.runDir).applied_at, lastApplyAt);
  // Verify appends results with a later timestamp and a status of its own.
  assert.equal(verify(ctx).status, 0);
  const again = run(APPLY, ['--run', ctx.runDir, '--write-receipt'], { env: ctx.env });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.counts.applied, 5);
  assert.equal(again.json.counts.pending, 0);
  assert.deepEqual(again.json.non_applied, []);
  // applied_at is still the apply's last attempt, not the verify's read.
  assert.equal(receiptFrontmatter(ctx.runDir).applied_at, lastApplyAt);
});
