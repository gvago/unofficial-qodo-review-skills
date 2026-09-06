import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, SKILL_VERSION } from '../lib/receipt-lib.mjs';
import {
  APPLY, FAKE_QODO, VERIFY,
  applyResults, confirmed, ledgerLines, readText, readWorkspace, receiptApplyStates,
  receiptFrontmatter, receiptStatuses, revertScript, run, runScript, seedWorkspace, updateLog,
} from './helpers.mjs';

const FAST = { CALIBRATE_BACKOFF_MS: '1', CALIBRATE_TEST_MODE: '1' };
const uncheck = (line) => line.replace('- [x] ', '- [ ] ');

const CURRENT = { 99: 'error', 101: 'error', 102: 'error', 103: 'warning', 104: 'warning', 105: 'warning', 106: 'warning', 107: 'error', 108: 'warning' };

// A confirmed run, applied against the fake workspace: the state a revert starts from.
function applied({ mode = 'ok', edits = [] } = {}) {
  const ctx = confirmed({ edits });
  ctx.workspace = seedWorkspace(ctx, CURRENT);
  ctx.log = join(ctx.runDir, 'update-log.jsonl');
  ctx.state = join(ctx.runDir, 'fake-state.json');
  const g = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(g.status, 0, g.stderr);
  ctx.apply = runScript(ctx, {
    FAKE_UPDATE_MODE: mode, FAKE_UPDATE_LOG: ctx.log, FAKE_STATE: ctx.state, FAKE_WORKSPACE: ctx.workspace, ...FAST,
  });
  ctx.revertLog = join(ctx.runDir, 'revert-log.jsonl');
  return ctx;
}

function generateRevert(ctx, args = []) {
  const res = run(APPLY, ['--run', ctx.runDir, '--generate', '--revert', '--qodo', FAKE_QODO, ...args], { env: ctx.env });
  ctx.generate = res.json;
  return res;
}

function runRevert(ctx, mode = 'ok', extra = {}) {
  return revertScript(ctx, {
    FAKE_UPDATE_MODE: mode, FAKE_UPDATE_LOG: ctx.revertLog, FAKE_STATE: join(ctx.runDir, 'revert-state.json'),
    FAKE_WORKSPACE: ctx.workspace, ...FAST, ...extra,
  });
}

function verify(ctx, env = {}) {
  return run(VERIFY, ['--run', ctx.runDir, '--qodo', FAKE_QODO], {
    env: { ...ctx.env, FAKE_WORKSPACE: ctx.workspace, FAKE_TOTAL: '110', ...env },
  });
}

const statusFor = (ctx, id) => new Map(receiptStatuses(ctx.runDir)).get(id);
const stateFor = (ctx, id) => new Map(receiptApplyStates(ctx.runDir)).get(id);
const tokensFor = (ctx, id) => readText(ctx.receipt).split('\n').find((l) => l.startsWith('- [') && l.includes(` ${id} · `));
const revertResults = (ctx) => applyResults(ctx.runDir).filter((r) => r.phase === 'revert');

// ---------------------------------------------------------------------------------------
// --generate --revert

test('--generate --revert writes revert.sh for the rows the receipt shows as changed', () => {
  // Approve 99 and 101, fail 102, skip 103 and 104: two applied rows to undo.
  const ctx = applied({ mode: 'fail:102:MT-VALIDATION', edits: [['- [x] 103 ', uncheck], ['- [x] 104 ', uncheck]] });
  assert.equal(statusFor(ctx, 102), 'failed(MT-VALIDATION)');
  const g = generateRevert(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.status, 'generated');
  assert.equal(g.json.rows_to_revert, 2);
  assert.deepEqual(g.json.rule_ids.slice().sort((a, b) => a - b), [99, 101]);
  // Every row the revert is not touching is named with a reason — including the rows the admin
  // unchecked before the apply, so nothing is silently absent from the report.
  assert.deepEqual(g.json.not_candidates.map((r) => r.rule_id).sort((a, b) => a - b), [102, 103, 104, 105, 106]);
  assert.equal(g.json.not_candidates.find((r) => r.rule_id === 102).reason, 'the apply failed and a verify found the rule still at its current severity');
  assert.equal(g.json.not_candidates.find((r) => r.rule_id === 103).reason, 'the admin never approved it, so nothing was written');
  assert.deepEqual(g.json.already_reverted, []);
  assert.equal(g.json.script, ctx.revert);

  const script = readText(ctx.revert);
  const lines = script.split('\n');
  assert.equal(lines[0], '#!/bin/sh');
  assert.match(lines[1], new RegExp(`^# qodo-calibrate-rules ${SKILL_VERSION} · run ${ctx.runId} · revert · 2 rows · `));
  assert.match(lines[2], /One Bash invocation reverts the whole batch: sh revert\.sh/);
  // The loop itself is the apply loop: same row function, same stop codes, no `set -e`.
  assert.ok(!script.includes('set -e'));
  assert.ok(lines[5].includes('--row "$1" --target "$2" --revert'));
  // Target is each row's `current`, and the key is the revert key — never the apply key, which a
  // key-caching server would replay.
  assert.ok(script.includes('row 99 error'), script);
  assert.ok(script.includes(`--severity error --json --idempotency-key calibrate-revert-${ctx.runId}-99`), script);
  assert.ok(script.includes(`--idempotency-key calibrate-revert-${ctx.runId}-101`), script);
  assert.ok(!script.includes(`calibrate-${ctx.runId}-99`), 'the apply key never appears');
  assert.match(script.trimEnd(), /--write-receipt --revert$/);
  assert.equal(spawnSync('sh', ['-n', ctx.revert]).status, 0, 'revert.sh is valid POSIX sh');
});

test('a failed row whose write landed is selected once verify has seen it', () => {
  const ctx = applied({ mode: 'exit1_at:103' });
  assert.equal(statusFor(ctx, 103), 'failed(non_zero_exit)');
  assert.equal(verify(ctx).status, EXIT.report);
  assert.match(tokensFor(ctx, 103), /· failed\(non_zero_exit\) · mismatch\(recommendation\)$/);
  const g = generateRevert(ctx);
  assert.ok(g.json.rule_ids.includes(103), `103 in ${g.json.rule_ids}`);
  assert.ok(readText(ctx.revert).includes('row 103 warning'), 'reverts to current, not to target');
});

test('a receipt with nothing changed reports nothing_to_revert and writes no script', () => {
  const ctx = applied({ mode: 'fail:99:MT-VALIDATION', edits: [['- [x] 101 ', uncheck], ['- [x] 102 ', uncheck], ['- [x] 103 ', uncheck], ['- [x] 104 ', uncheck]] });
  const g = generateRevert(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.status, 'nothing_to_revert');
  assert.equal(g.json.rows_to_revert, 0);
  assert.equal(g.json.script, null);
  assert.equal(existsSync(ctx.revert), false);
});

test('--generate --revert without a receipt refuses', () => {
  const ctx = confirmed();
  const g = run(APPLY, ['--run', ctx.runDir, '--generate', '--revert', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(g.status, EXIT.refused);
  assert.match(g.stderr, /receipt\.md missing/);
  assert.match(g.stderr, /Nothing written/);
});

// ---------------------------------------------------------------------------------------
// The revert loop

test('a happy revert puts every row back at current and writes no ledger entry', () => {
  const ctx = applied();
  const ledgerBefore = ledgerLines(ctx.ledger);
  assert.ok(ledgerBefore.some((e) => e.decision === 'approve'), 'the apply recorded approvals');
  const g = generateRevert(ctx);
  assert.equal(g.json.rows_to_revert, 5);
  const res = runRevert(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'reverted');
  // 105 and 106 are the two `[?]` rows: never applied, so never revert candidates.
  assert.deepEqual(res.json.counts, { reverted: 5, failed: 0, deferred: 0, pending: 0, not_candidates: 2 });
  assert.equal(res.json.closed_for_apply, true);
  assert.deepEqual(res.json.non_reverted, []);
  assert.equal(res.json.aborted, false);
  assert.equal(res.json.ledger_recorded, 0);
  for (const id of [99, 101, 102, 103, 104]) {
    assert.match(tokensFor(ctx, id), /· applied · reverted$/, `row ${id}`);
    assert.equal(stateFor(ctx, id), 'reverted');
  }
  // The workspace is back where it started, and every call named the row's current severity.
  const ws = readWorkspace(ctx);
  for (const id of [99, 101, 102, 103, 104]) assert.equal(ws[String(id)], CURRENT[id], `workspace ${id}`);
  for (const call of updateLog(ctx.revertLog)) {
    assert.equal(call.severity, CURRENT[call.rule_id], `target for ${call.rule_id}`);
    assert.equal(call.key, `calibrate-revert-${ctx.runId}-${call.rule_id}`);
  }
  // The ledger is untouched: an `approve` holds only while the rule sits at that severity, so a
  // reverted rule is re-proposed by the hold rule itself.
  assert.deepEqual(ledgerLines(ctx.ledger), ledgerBefore);
  const fm = receiptFrontmatter(ctx.runDir);
  assert.match(String(fm.reverted_at), /^\d{4}-\d\d-\d\dT/);
  assert.equal(String(fm.revert_exit_code), '0');
});

test('a revert failure keeps the apply state and is re-sent by the next generate', () => {
  const ctx = applied();
  generateRevert(ctx);
  const res = runRevert(ctx, 'fail:101:MT-VALIDATION');
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.status, 'incomplete');
  assert.equal(res.json.counts.reverted, 4);
  assert.equal(res.json.counts.failed, 1);
  assert.deepEqual(res.json.non_reverted, [{ rule_id: 101, status: 'failed', code: 'MT-VALIDATION' }]);
  assert.match(tokensFor(ctx, 101), /· applied · failed\(revert:MT-VALIDATION\)$/);
  // The apply state is still `applied`: the rule is at the target, so the row is a candidate again.
  assert.equal(stateFor(ctx, 101), 'applied');
  const again = generateRevert(ctx);
  assert.deepEqual(again.json.rule_ids, [101]);
  assert.deepEqual(again.json.already_reverted.sort((a, b) => a - b), [99, 102, 103, 104]);
});

test('an exhausted rate limit folds to failed(revert:…) too, so the row is re-sent', () => {
  const ctx = applied();
  generateRevert(ctx);
  const res = runRevert(ctx, 'ratelimit:102:99');
  assert.equal(res.status, EXIT.report);
  // The token says `failed(revert:…)`, so the count and the report say `failed` too — the JSON and
  // the receipt must not describe the same row two different ways.
  assert.equal(res.json.counts.deferred, 0);
  assert.equal(res.json.counts.failed, 1);
  assert.deepEqual(res.json.non_reverted, [{ rule_id: 102, status: 'failed', code: 'MT-RATE-LIMITED' }]);
  assert.match(tokensFor(ctx, 102), /· applied · failed\(revert:MT-RATE-LIMITED\)$/);
  assert.equal(stateFor(ctx, 102), 'applied');
});

test('an abort stops the revert loop and leaves the later rows untouched', () => {
  const ctx = applied();
  const g = generateRevert(ctx);
  const [first, second, third] = g.json.rule_ids;
  const res = runRevert(ctx, `auth_at:${second}`);
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.aborted, true);
  assert.equal(stateFor(ctx, first), 'reverted');
  for (const id of [second, third]) assert.equal(stateFor(ctx, id), 'applied', `row ${id} untouched`);
  // Only the aborting row was called after the first one.
  assert.deepEqual(updateLog(ctx.revertLog).map((c) => Number(c.rule_id)), [first, second]);
  assert.equal(res.json.counts.pending, 4);
  assert.equal(revertResults(ctx).find((r) => r.rule_id === second).status, 'aborted');
});

test('a resumed revert regenerates only the rows still to undo', () => {
  const ctx = applied();
  const g = generateRevert(ctx);
  const [first, second] = g.json.rule_ids;
  runRevert(ctx, `auth_at:${second}`);
  const again = generateRevert(ctx);
  assert.equal(again.json.rows_to_revert, 4);
  assert.ok(!again.json.rule_ids.includes(first), 'the reverted row is not regenerated');
  assert.ok(!readText(ctx.revert).includes(`row ${first} `), 'and is not in the script');
  const second_run = runRevert(ctx);
  assert.equal(second_run.status, 0, second_run.stderr);
  // The launcher was never asked about the already-reverted row in the second pass.
  const calls = updateLog(join(ctx.runDir, 'revert-log.jsonl')).map((c) => Number(c.rule_id));
  assert.equal(calls.filter((id) => id === first).length, 1, 'called once, in the first pass only');
});

test('a row already reverted reports already_reverted and exits 0', () => {
  const ctx = applied();
  generateRevert(ctx);
  assert.equal(runRevert(ctx).status, 0);
  const again = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'error', '--revert', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.status, 'already_reverted');
});

// ---------------------------------------------------------------------------------------
// Guards

test('a stale revert script is refused with nothing written', () => {
  const ctx = applied();
  generateRevert(ctx);
  const before = readText(ctx.receipt);
  // 103's current is `warning`; a script asking for `error` does not describe this receipt.
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '103', '--target', 'error', '--revert', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /reverts to "warning" in .*receipt\.md but revert\.sh asks for "error"/);
  assert.match(res.stderr, /revert\.sh is stale/);
  assert.equal(readText(ctx.receipt), before);
  const last = revertResults(ctx).pop();
  assert.equal(last.status, 'aborted');
  assert.equal(last.code, 'stale_script');
  assert.equal(updateLog(ctx.revertLog).length, 0, 'the launcher was never called');
});

test('a row the receipt does not show as changed is never reverted', () => {
  const ctx = applied({ mode: 'fail:102:MT-VALIDATION' });
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '102', '--target', 'error', '--revert', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /is not a revert candidate .*\(apply state failed\)/);
});

test('a reverted run is closed for apply', () => {
  const ctx = applied();
  generateRevert(ctx);
  assert.equal(runRevert(ctx).status, 0);
  const before = readText(ctx.receipt);

  const gen = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(gen.status, EXIT.refused);
  assert.match(gen.stderr, /was reverted .* this run is closed for apply; start a new run/);
  assert.match(gen.stderr, /--generate wrote nothing/);
  assert.equal(readText(ctx.receipt), before);

  const row = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'recommendation', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(row.status, EXIT.refused);
  assert.match(row.stderr, /closed for apply/);
  assert.equal(readText(ctx.receipt), before);
  // A revert generate still works — it just has nothing left to do.
  assert.equal(generateRevert(ctx).json.status, 'nothing_to_revert');
});

test('verify after a revert expects current and passes', () => {
  const ctx = applied();
  generateRevert(ctx);
  assert.equal(runRevert(ctx).status, 0);
  const res = verify(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.counts.checked, 5);
  assert.equal(res.json.counts.verified, 5);
  for (const id of [99, 101, 102, 103, 104]) {
    assert.match(tokensFor(ctx, id), /· applied · reverted · verified$/, `row ${id}`);
    assert.equal(res.json.mismatches.length, 0);
  }
});

// ---------------------------------------------------------------------------------------
// Findings from the code review of this phase

test('a revert that reverted nothing does not close the run for apply', () => {
  // The abort lands on the first row, so no rule came back to `current` and the receipt still
  // describes the workspace. Closing the run here would strand the admin with a receipt they can
  // neither finish applying nor revert.
  const ctx = applied();
  const g = generateRevert(ctx);
  const first = g.json.rule_ids[0];
  const res = runRevert(ctx, `auth_at:${first}`);
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.aborted, true);
  assert.equal(res.json.counts.reverted, 0);
  assert.equal(res.json.closed_for_apply, false);
  // reverted_at is absent; the attempt is still on the record through revert_exit_code.
  const fm = receiptFrontmatter(ctx.runDir);
  assert.equal(fm.reverted_at, undefined);
  assert.equal(String(fm.revert_exit_code), '3');
  // Apply is therefore still open: --generate reports the rows it would re-send.
  const gen = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(gen.status, 0, gen.stderr);
  assert.equal(gen.json.status, 'nothing_to_apply'); // every row is already `· applied`
  assert.deepEqual(gen.json.already_applied.sort((a, b) => a - b), [99, 101, 102, 103, 104]);
});

test('a revert that reverted some rows closes the run even though it aborted', () => {
  const ctx = applied();
  const g = generateRevert(ctx);
  const second = g.json.rule_ids[1];
  const res = runRevert(ctx, `auth_at:${second}`);
  assert.equal(res.json.counts.reverted, 1);
  assert.equal(res.json.closed_for_apply, true);
  assert.ok(receiptFrontmatter(ctx.runDir).reverted_at, 'reverted_at is stamped');
  // Half the workspace has been put back, so re-applying this receipt would undo the undo.
  const gen = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(gen.status, EXIT.refused);
  assert.match(gen.stderr, /closed for apply/);
});

test('a row unchecked in receipt.md after a successful apply is still reverted', () => {
  // Selection is on the apply state, not the checkbox: the receipt says the apply changed this
  // rule, so the revert owns it even though the checklist no longer approves it.
  const ctx = applied();
  writeFileSync(ctx.receipt, readText(ctx.receipt).split('\n').map((l) => (l.startsWith('- [x] 101 ') ? uncheck(l) : l)).join('\n'));
  const g = generateRevert(ctx);
  assert.ok(g.json.rule_ids.includes(101), `101 in ${g.json.rule_ids}`);
  assert.deepEqual(g.json.unchecked_but_changed, [{ rule_id: 101, decision: 'skip', apply_state: 'applied' }]);
  assert.match(g.stderr, /rule 101 is `skip` in the checklist but `· applied` in the receipt/);
  const res = runRevert(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(stateFor(ctx, 101), 'reverted');
  assert.equal(readWorkspace(ctx)['101'], CURRENT[101]);
});

test('a rule that verify found missing is never sent an update', () => {
  const ctx = applied();
  assert.equal(verify(ctx, { FAKE_DELETED: '101' }).status, EXIT.report);
  assert.equal(statusFor(ctx, 101), 'mismatch(missing)');
  const g = generateRevert(ctx);
  assert.ok(!g.json.rule_ids.includes(101), `101 excluded from ${g.json.rule_ids}`);
  assert.equal(g.json.not_candidates.find((r) => r.rule_id === 101).reason, 'the rule is gone from the active set');
  const res = runRevert(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(updateLog(ctx.revertLog).map((c) => Number(c.rule_id)).filter((id) => id === 101), []);
});

test('re-running a pre-revert apply.sh after a revert writes nothing', () => {
  const ctx = applied();
  generateRevert(ctx);
  assert.equal(runRevert(ctx).status, 0);
  const before = readText(ctx.receipt);
  const ledgerBefore = ledgerLines(ctx.ledger);
  const appliedAt = receiptFrontmatter(ctx.runDir).applied_at;

  // apply.sh is still on disk from before the revert.
  const res = runScript(ctx, { FAKE_UPDATE_MODE: 'ok', FAKE_UPDATE_LOG: ctx.log, FAKE_WORKSPACE: ctx.workspace, ...FAST });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /closed for apply/);
  assert.match(res.stderr, /--write-receipt wrote nothing/);
  // Nothing re-stamped, no ledger entry, and the workspace was never touched again.
  assert.equal(readText(ctx.receipt), before);
  assert.equal(receiptFrontmatter(ctx.runDir).applied_at, appliedAt);
  assert.deepEqual(ledgerLines(ctx.ledger), ledgerBefore);
  for (const id of [99, 101, 102, 103, 104]) assert.equal(readWorkspace(ctx)[String(id)], CURRENT[id], `workspace ${id}`);
});
