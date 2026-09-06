import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../lib/receipt-lib.mjs';
import {
  APPLY, APPROVE, CALIB_DECISIONS, CALIB_PRECHECKED, CALIB_RULES, CALIB_TAGS, FAKE_QODO,
  LEDGER, PROPOSAL, RECORD,
  applyResults, confirmed, ledgerLines, readText, receiptStatuses, run, runScript,
  updateLog, writeBatch, writeExport,
} from './helpers.mjs';

// The backoff override only takes effect with CALIBRATE_TEST_MODE, so a stray env var cannot
// make a real rate-limited run retry instantly.
const FAST = { CALIBRATE_BACKOFF_MS: '1', CALIBRATE_TEST_MODE: '1' };
const uncheck = (line) => line.replace('- [x] ', '- [ ] ');
const retarget = (to) => (line) => line.replace(/→ \S+/, `→ ${to}`);

function generate(ctx, args = []) {
  const res = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', FAKE_QODO, ...args], { env: ctx.env });
  return res;
}

// A confirmed run whose apply.sh is already generated, plus a per-run launcher log.
function generated(options = {}) {
  const ctx = confirmed(options);
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  ctx.generate = g.json;
  ctx.log = join(ctx.runDir, 'update-log.jsonl');
  ctx.state = join(ctx.runDir, 'fake-state.json');
  return ctx;
}

function apply(ctx, mode, extra = {}) {
  return runScript(ctx, { FAKE_UPDATE_MODE: mode, FAKE_UPDATE_LOG: ctx.log, FAKE_STATE: ctx.state, ...FAST, ...extra });
}

const statusFor = (ctx, ruleId) => new Map(receiptStatuses(ctx.runDir)).get(ruleId);
// --generate records the admin's skips too, so the apply-side assertions look at the entries
// apply actually wrote.
const appliedLedger = (ctx) => ledgerLines(ctx.ledger).filter((e) => e.decision === 'approve' || e.decision === 'override');
const skipLedger = (ctx) => ledgerLines(ctx.ledger).filter((e) => e.decision === 'skip');

// ---------------------------------------------------------------------------------------
// Generate

test('--generate writes apply.sh and receipt.md from the confirmed readback', () => {
  // Approve 99 and 101, override 103, make 102 an invalid override, skip 104 — plus the two
  // needs-a-decision rows, which stay `[?]` and are therefore deferred, not skipped.
  const ctx = generated({
    edits: [
      ['- [x] 102 ', retarget('critical')],
      ['- [x] 103 ', retarget('error')],
      ['- [x] 104 ', uncheck],
    ],
  });
  assert.deepEqual(ctx.readback.counts, { approve: 2, skip: 1, defer: 2, override: 1, invalid: 1, removed: 0 });
  assert.equal(ctx.generate.status, 'generated');
  assert.equal(ctx.generate.rows_to_apply, 3);
  assert.deepEqual(ctx.generate.rule_ids, [99, 101, 103]); // file order
  assert.deepEqual(ctx.generate.invalid.map((i) => i.rule_id), [102]);
  assert.equal(ctx.generate.skipped, 1);
  assert.equal(ctx.generate.source, 'proposal.md');

  const script = readText(ctx.script);
  assert.deepEqual(script.split('\n').filter((l) => l.startsWith('row ')).map((l) => l.split(/\s+/).slice(0, 3).join(' ')), [
    'row 99 recommendation', 'row 101 recommendation', 'row 103 error',
  ]);
  assert.equal(spawnSync('sh', ['-n', ctx.script]).status, 0, 'generated script must parse');
  assert.ok(statSync(ctx.script).mode & 0o100, 'apply.sh is executable');

  // Receipt: apply rows pending, the explicit skip tokened, deferred rows carry no token, and
  // the invalid row is untouched.
  assert.deepEqual(receiptStatuses(ctx.runDir), [
    [99, 'pending'], [101, 'pending'], [102, 'pending'], [103, 'pending'],
    [104, 'skipped'], [105, 'pending'], [106, 'pending'],
  ]);
  for (const id of CALIB_DECISIONS) {
    assert.ok(readText(ctx.receipt).split('\n').find((l) => l.startsWith(`- [?] ${id} `)).endsWith(`/rules/${id}`), 'a deferred row gets no · skipped token');
  }
  // The invalid row is reported and left exactly as the admin wrote it — no token, no rewrite.
  const invalidLine = readText(ctx.receipt).split('\n').find((l) => l.startsWith('- [x] 102 '));
  assert.ok(invalidLine.endsWith('https://app.qodo.ai/rules/102'));
  assert.ok(readText(ctx.proposal).includes(invalidLine));
  // proposal.md is never modified.
  assert.equal(readText(ctx.proposal).includes('· skipped'), false);
  assert.deepEqual(applyResults(ctx.runDir), []);
});

test('--generate refuses a checklist whose run_id names another run, and writes nothing', () => {
  const ctx = confirmed();
  writeFileSync(ctx.proposal, readText(ctx.proposal).replace('run_id: 20260101-000000', 'run_id: 19990101-000000'));
  const g = generate(ctx);
  assert.equal(g.status, EXIT.refused);
  assert.match(g.stderr, /does not match the run folder "20260101-000000"/);
  assert.equal(existsSync(ctx.receipt), false);
  assert.equal(existsSync(ctx.script), false);
});

test('--generate refuses a run with no proposal at all', () => {
  const ctx = confirmed();
  writeFileSync(ctx.proposal, '');
  const g = generate(ctx);
  assert.equal(g.status, EXIT.refused);
  assert.match(g.stderr, /no frontmatter/);
});

test('with every row unchecked there is nothing to apply and no script', () => {
  // Deferred rows must be unchecked explicitly: `[?]` is not a skip.
  const ctx = confirmed({ edits: [['- [x] ', uncheck], ['- [?] ', (l) => l.replace('- [?] ', '- [ ] ')]] });
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.status, 'nothing_to_apply');
  assert.equal(g.json.rows_to_apply, 0);
  assert.equal(g.json.script, null);
  assert.equal(g.json.skipped, 7);
  assert.equal(existsSync(join(ctx.runDir, 'apply.sh')), false);
  assert.ok(receiptStatuses(ctx.runDir).every(([, s]) => s === 'skipped'));
});

test('a deferred row is left out of the script, gets no · skipped token, and is reported', () => {
  // 106 is approved, 105 stays `[?]`: exactly one deferred row.
  const ctx = generated({ edits: [[`- [?] ${CALIB_DECISIONS[1]} `, (l) => l.replace('- [?] ', '- [x] ')]] });
  assert.equal(ctx.readback.counts.defer, 1);
  assert.equal(ctx.generate.counts.defer, 1);
  assert.equal(ctx.generate.skipped, 0);
  assert.equal(ctx.generate.skips_recorded, 0);
  assert.equal(ctx.generate.rule_ids.includes(CALIB_DECISIONS[0]), false);
  assert.equal(readText(ctx.script).includes(`row ${CALIB_DECISIONS[0]} `), false);

  const deferredRow = readText(ctx.receipt).split('\n').find((l) => l.includes(`] ${CALIB_DECISIONS[0]} `));
  assert.ok(deferredRow.startsWith(`- [?] ${CALIB_DECISIONS[0]} `), deferredRow);
  assert.equal(deferredRow.includes('· skipped'), false);

  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.counts.deferred_by_admin, 1);
  assert.equal(res.json.counts.skipped, 0);
  assert.equal(ledgerLines(ctx.ledger).some((e) => e.rule_id === CALIB_DECISIONS[0]), false);
});

// ---------------------------------------------------------------------------------------
// The loop

test('the happy loop applies every row, records the ledger, and exits 0', () => {
  const ctx = generated();
  assert.equal(ctx.generate.rows_to_apply, 5);
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.counts, { applied: 5, failed: 0, deferred: 0, pending: 0, skipped: 0, deferred_by_admin: 2, invalid: 0 });
  assert.deepEqual(res.json.non_applied, []);
  assert.equal(res.json.aborted, false);
  assert.equal(res.json.exit_code, 0);
  assert.equal(res.json.receipt, ctx.receipt);

  assert.deepEqual(receiptStatuses(ctx.runDir), [
    [99, 'applied'], [101, 'applied'], [102, 'applied'], [103, 'applied'], [104, 'applied'],
    [105, 'pending'], [106, 'pending'],
  ]);
  assert.equal(applyResults(ctx.runDir).length, 5);
  assert.ok(applyResults(ctx.runDir).every((r) => r.status === 'applied' && r.attempt === 1));

  const receipt = readText(ctx.receipt);
  assert.match(receipt, /^apply_exit_code: 0$/m);
  assert.match(receipt, /^applied_at: \d{4}-\d{2}-\d{2}T/m);

  const ledger = appliedLedger(ctx);
  assert.deepEqual(ledger.map((e) => e.rule_id), CALIB_PRECHECKED.slice().sort((a, b) => a - b));
  assert.deepEqual([...new Set(ledger.map((e) => e.decision))], ['approve']);
  assert.deepEqual(skipLedger(ctx), []); // the deferred rows are recorded nowhere
  for (const entry of ledger) {
    assert.ok(entry.content_hash.startsWith('sha256:'));
    assert.equal(entry.run_id, ctx.runId);
    assert.equal(entry.severity_at_decision, entry.rule_id === 104 ? 'error' : 'recommendation');
  }
});

test('an override is applied at the admin\'s value and recorded as an override', () => {
  const ctx = generated({ edits: [['- [x] 101 ', retarget('warning')]] });
  assert.equal(ctx.readback.counts.override, 1);
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  const call = updateLog(ctx.log).find((c) => c.rule_id === '101');
  assert.equal(call.severity, 'warning');
  const entry = appliedLedger(ctx).find((e) => e.rule_id === 101);
  assert.equal(entry.decision, 'override');
  assert.equal(entry.severity_at_decision, 'warning');
});

test('the launcher argv is the one write and nothing else', () => {
  const ctx = generated();
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  const calls = updateLog(ctx.log);
  assert.deepEqual(calls.map((c) => c.rule_id), ['99', '101', '102', '103', '104']);
  assert.deepEqual(calls[0].argv, [
    'rules', 'update', '--rule-id', '99', '--severity', 'recommendation', '--json', '--idempotency-key', `calibrate-${ctx.runId}-99`,
  ]);
  for (const call of calls) assert.equal(call.key, `calibrate-${ctx.runId}-${call.rule_id}`);
});

test('a non-default rules-update command path is carried through the script', () => {
  const ctx = confirmed();
  const g = generate(ctx, ['--update-args', 'write rules update']);
  assert.equal(g.status, 0, g.stderr);
  ctx.log = join(ctx.runDir, 'update-log.jsonl');
  ctx.state = join(ctx.runDir, 'fake-state.json');
  const res = apply(ctx, 'ok', { FAKE_UPDATE_ARGS: 'write rules update' });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(updateLog(ctx.log)[0].argv.slice(0, 3), ['write', 'rules', 'update']);
});

test('any other error fails just that row, the loop continues, and the report names it', () => {
  const ctx = generated();
  const res = apply(ctx, 'fail:103:MT-VALIDATION');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 103), 'failed(MT-VALIDATION)');
  assert.deepEqual(res.json.counts, { applied: 4, failed: 1, deferred: 0, pending: 0, skipped: 0, deferred_by_admin: 2, invalid: 0 });
  assert.deepEqual(res.json.non_applied, [{ rule_id: 103, status: 'failed', code: 'MT-VALIDATION' }]);
  assert.match(res.stderr, /103 failed\(MT-VALIDATION\)/);
  assert.deepEqual(updateLog(ctx.log).map((c) => c.rule_id), ['99', '101', '102', '103', '104']); // 104 still called
  assert.match(readText(ctx.receipt), /^apply_exit_code: 3$/m);
  // A failed row is not a decision in the workspace, so it is not in the ledger.
  assert.equal(appliedLedger(ctx).some((e) => e.rule_id === 103), false);
  assert.equal(appliedLedger(ctx).length, 4);
});

test('a rate limit retries the same row and applies it', () => {
  const ctx = generated();
  const res = apply(ctx, 'ratelimit:102:2');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, 102), 'applied');
  const attempts = applyResults(ctx.runDir).filter((r) => r.rule_id === 102);
  assert.deepEqual(attempts.map((r) => [r.attempt, r.status]), [[1, 'retrying'], [2, 'retrying'], [3, 'applied']]);
  assert.deepEqual([...new Set(attempts.slice(0, 2).map((r) => r.code))], ['MT-RATE-LIMITED']);
  assert.equal(updateLog(ctx.log).filter((c) => c.rule_id === '102').length, 3);
});

test('an upstream outage is retried on the same terms as a rate limit', () => {
  const ctx = generated();
  const res = apply(ctx, 'upstream:104:1');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, 104), 'applied');
  assert.deepEqual(applyResults(ctx.runDir).filter((r) => r.rule_id === 104).map((r) => [r.attempt, r.status, r.code]), [
    [1, 'retrying', 'MT-UPSTREAM-DOWN'], [2, 'applied', null],
  ]);
});

test('a rate limit past the retry ceiling defers the row and exits 3', () => {
  const ctx = generated();
  const res = apply(ctx, 'ratelimit:102:6');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 102), 'deferred');
  assert.equal(applyResults(ctx.runDir).filter((r) => r.rule_id === 102).length, 6); // 1 call + 5 retries
  assert.deepEqual(res.json.counts, { applied: 4, failed: 0, deferred: 1, pending: 0, skipped: 0, deferred_by_admin: 2, invalid: 0 });
  assert.deepEqual(res.json.non_applied, [{ rule_id: 102, status: 'deferred', code: 'MT-RATE-LIMITED' }]);
  assert.match(res.stderr, /102 deferred\(MT-RATE-LIMITED\)/);
  assert.equal(appliedLedger(ctx).some((e) => e.rule_id === 102), false);
});

test('an auth error aborts the loop and leaves every later row pending', () => {
  const ctx = generated();
  const res = apply(ctx, 'auth_at:102'); // the 3rd of 5 rows
  // The rows stop at the abort, but the script still ends in --write-receipt: exit 3 and a report.
  assert.equal(res.status, EXIT.report, res.stderr);
  assert.deepEqual(updateLog(ctx.log).map((c) => c.rule_id), ['99', '101', '102']); // no call after row 3
  assert.equal(applyResults(ctx.runDir).length, 3); // and no --row result for rows 4 and 5 either
  assert.deepEqual(receiptStatuses(ctx.runDir), [
    [99, 'applied'], [101, 'applied'], [102, 'pending'], [103, 'pending'], [104, 'pending'],
    [105, 'pending'], [106, 'pending'],
  ]);
  assert.equal(res.json.aborted, true);
  assert.deepEqual(res.json.counts, { applied: 2, failed: 0, deferred: 0, pending: 3, skipped: 0, deferred_by_admin: 2, invalid: 0 });
  assert.deepEqual(res.json.non_applied, [
    { rule_id: 102, status: 'pending', code: 'not_logged_in' },
    { rule_id: 103, status: 'pending', code: null },
    { rule_id: 104, status: 'pending', code: null },
  ]);
  assert.match(res.stderr, /102 pending\(not_logged_in\)/);
  assert.match(res.stderr, /abort class, the loop stops/);
  assert.deepEqual(appliedLedger(ctx).map((e) => e.rule_id), [99, 101]);
  // Asking for the report again by hand says the same thing and records nothing new.
  const report = run(APPLY, ['--run', ctx.runDir, '--write-receipt'], { env: ctx.env });
  assert.equal(report.status, EXIT.report);
  assert.equal(report.json.aborted, true);
  assert.equal(report.json.ledger_recorded, 0);
  assert.deepEqual(appliedLedger(ctx).map((e) => e.rule_id), [99, 101]);
});

test('a response at the wrong severity fails the row as a mismatch', () => {
  const ctx = generated();
  const res = apply(ctx, 'mismatch:101');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 101), 'failed(response_mismatch)');
  assert.deepEqual(res.json.non_applied, [{ rule_id: 101, status: 'failed', code: 'response_mismatch' }]);
});

test('a non-JSON response fails the row rather than being read as success', () => {
  const ctx = generated();
  const res = apply(ctx, 'garbage:101');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 101), 'failed(invalid_json)');
});

test('a launcher that cannot be spawned aborts the loop', () => {
  const ctx = confirmed();
  const g = run(APPLY, ['--run', ctx.runDir, '--generate', '--qodo', join(ctx.runDir, 'no-such-qodo')], { env: ctx.env });
  assert.equal(g.status, 0, g.stderr);
  const res = runScript(ctx, FAST);
  assert.equal(res.status, EXIT.report);
  assert.equal(res.json.aborted, true);
  assert.equal(res.json.counts.pending, CALIB_PRECHECKED.length);
  // the deferred rows carry no token either, so they read `pending` in the receipt too
  assert.deepEqual(receiptStatuses(ctx.runDir).filter(([, s]) => s === 'pending').map(([id]) => id), [...CALIB_PRECHECKED, ...CALIB_DECISIONS].sort((a, b) => a - b));
  assert.equal(applyResults(ctx.runDir).filter((r) => r.status === 'aborted').length, 1);
  assert.equal(applyResults(ctx.runDir).length, 1); // the rows after the abort were never attempted
});

// ---------------------------------------------------------------------------------------
// Resume, folding, and the ledger

test('regenerating after a partial run applies only the rows that are not applied', () => {
  const ctx = generated();
  const first = apply(ctx, 'fail:103:MT-VALIDATION');
  assert.equal(first.status, EXIT.report);

  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.source, 'receipt.md');
  assert.equal(g.json.rows_to_apply, 1);
  assert.deepEqual(g.json.rule_ids, [103]);
  assert.deepEqual(g.json.already_applied, [99, 101, 102, 104]);

  const secondLog = join(ctx.runDir, 'second-log.jsonl');
  const second = runScript(ctx, { FAKE_UPDATE_MODE: 'ok', FAKE_UPDATE_LOG: secondLog, ...FAST });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(updateLog(secondLog).map((c) => c.rule_id), ['103']); // no id applied twice
  assert.ok(receiptStatuses(ctx.runDir).slice(0, 5).every(([, s]) => s === 'applied'));
  // Both runs' attempts are kept, and the row shows the accumulated history.
  assert.equal(applyResults(ctx.runDir).length, 6);
  assert.match(readText(ctx.receipt), /- \[x\] 103 .* · failed\(MT-VALIDATION\) · applied$/m);
  assert.deepEqual(appliedLedger(ctx).map((e) => e.rule_id).sort((a, b) => a - b), [99, 101, 102, 103, 104]);
});

test('a resume prefers the receipt and warns that an edited proposal.md is ignored', () => {
  const ctx = generated();
  writeFileSync(ctx.proposal, readText(ctx.proposal).replace('- [x] 104 ', '- [ ] 104 '));
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.source, 'receipt.md');
  assert.equal(g.json.rows_to_apply, 5); // the receipt still has 104 checked
  assert.equal(g.json.warnings.length, 1);
  assert.match(g.json.warnings[0], /proposal\.md is ignored/);
  assert.match(g.stderr, /proposal\.md is ignored/);
});

test('a result the receipt is missing is folded in before anything else happens', () => {
  const ctx = generated();
  // Simulate a crash between the results append and the receipt rewrite.
  appendFileSync(join(ctx.runDir, 'apply-results.jsonl'), `${JSON.stringify({
    rule_id: 99, target: 'recommendation', current: 'error', status: 'applied', code: null, attempt: 1,
    idempotency_key: `calibrate-${ctx.runId}-99`, at: new Date().toISOString(),
  })}\n`);
  assert.equal(statusFor(ctx, 99), 'pending');

  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(statusFor(ctx, 99), 'applied');
  assert.equal(g.json.rows_to_apply, 4);
  assert.deepEqual(g.json.already_applied, [99]);
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(updateLog(ctx.log).some((c) => c.rule_id === '99'), false);
});

test('--write-receipt twice adds no second ledger entry', () => {
  const ctx = generated();
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.ledger_recorded, 5);
  const again = run(APPLY, ['--run', ctx.runDir, '--write-receipt'], { env: ctx.env });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.ledger_recorded, 0);
  assert.equal(appliedLedger(ctx).length, 5);
  assert.deepEqual(again.json.counts, res.json.counts);
});

test("this run's own ledger entries never hold this run's rows", () => {
  const ctx = generated();
  assert.equal(apply(ctx, 'ok').status, 0);
  // The apply wrote approve entries for all five rows, and the skips are recorded too — yet a
  // repeated readback of the same run still sees every row it rendered, so a resume works.
  assert.equal(appliedLedger(ctx).length, 5);
  assert.equal(skipLedger(ctx).length, 0); // the two deferred rows are never recorded
  const again = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.rendered_rows, 7);
  assert.equal(again.json.counts.approve + again.json.counts.override, 5);
  assert.equal(again.json.counts.skip, 0);
  assert.equal(again.json.counts.defer, 2);
  assert.deepEqual(again.json.invalid, []);
});

test('a later run holds an applied override and re-proposes a rule whose severity drifted', () => {
  // 101 is overridden to warning; the other four are plain approvals at the rubric's value.
  const ctx = generated({ edits: [['- [x] 101 ', retarget('warning')]] });
  assert.equal(apply(ctx, 'ok').status, 0);
  const applied = new Map(appliedLedger(ctx).map((e) => [e.rule_id, e.severity_at_decision]));
  assert.equal(applied.get(101), 'warning');
  assert.equal(applied.size, 5);

  // A second run re-exports and re-classifies. Every rule now reads where this run put it —
  // except 104, which someone moved back in the portal afterwards (a drift).
  const nextId = '20260202-000000';
  const nextDir = join(ctx.calibrate, 'runs', nextId);
  cpSync(ctx.runDir, nextDir, { recursive: true });
  for (const stale of ['proposal.md', 'receipt.md', 'apply.sh', 'apply-results.jsonl', 'classification.json', 'classification.jsonl']) {
    if (existsSync(join(nextDir, stale))) rmSync(join(nextDir, stale));
  }
  const atApplied = CALIB_RULES.map((r) => {
    if (r.ruleId === 104) return { ...r, severity: 'warning' }; // drifted back off `error`
    return applied.has(r.ruleId) ? { ...r, severity: applied.get(r.ruleId) } : r;
  });
  writeExport(nextDir, atApplied, nextId);
  writeBatch(nextDir, 1, atApplied);
  const reclassified = run(RECORD, ['--run', nextDir, '--batch', '1', '--tags', JSON.stringify(CALIB_TAGS)], { env: ctx.env });
  assert.equal(reclassified.status, 0, reclassified.stderr);
  const rendered = run(PROPOSAL, ['--run', nextDir, '--render', '--workspace-id', 'ws-1'], { env: ctx.env });
  assert.equal(rendered.status, 0, rendered.stderr);

  // Held, and counted in the footer: the override alone (its content hash is unchanged). 99, 102
  // and 103 now sit at the rubric's own value, so they are simply unchanged and never reach the
  // proposal at all — the proposal is a diff. The deferred rows were recorded nowhere, so they
  // come back as needs-a-decision rows.
  assert.equal(rendered.json.held_by_prior_decision, 1);
  const text = readText(join(nextDir, 'proposal.md'));
  assert.equal(text.includes('] 101 ·'), false, 'rule 101 must be held');
  for (const id of [99, 102, 103]) assert.equal(text.includes(`] ${id} ·`), false, `rule ${id} is unchanged`);
  for (const id of CALIB_DECISIONS) assert.match(text, new RegExp(`^- \\[\\?\\] ${id} · `, 'm'));
  assert.match(text, /^Held by prior decision: 1 rules/m);

  // Re-proposed: an `approve` holds only while the rule still sits at the approved severity, so
  // the drifted rule comes back.
  assert.equal(rendered.json.rows, 3); // the drifted rule plus the two deferred rows
  assert.match(text, /^- \[x\] 104 · .* · warning → error · /m);

  // Releasing the override puts it back too, which is what the footer's escape hatch promises.
  const released = run(LEDGER, ['--reconsider', '101'], { env: ctx.env });
  assert.equal(released.status, 0, released.stderr);
  const again = run(PROPOSAL, ['--run', nextDir, '--render', '--workspace-id', 'ws-1', '--replace'], { env: ctx.env });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.held_by_prior_decision, 0);
  assert.match(readText(join(nextDir, 'proposal.md')), /^- \[x\] 101 · /m);
});

test('--row refuses a rule that has no row in this run\'s receipt', () => {
  const ctx = generated();
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '424242', '--target', 'error', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /has no row in/);
  assert.deepEqual(applyResults(ctx.runDir), []);
});

test('--row refuses a target that is not a severity and never calls the launcher', () => {
  const ctx = generated();
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'critical', '--qodo', FAKE_QODO], { env: ctx.env });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /is not a severity/);
  assert.deepEqual(updateLog(ctx.log), []);
});

test('--row on an already applied row is a no-op', () => {
  const ctx = generated();
  assert.equal(apply(ctx, 'ok').status, 0);
  const before = applyResults(ctx.runDir).length;
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'recommendation', '--qodo', FAKE_QODO], { env: { ...ctx.env, FAKE_UPDATE_LOG: ctx.log } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'already_applied');
  assert.equal(applyResults(ctx.runDir).length, before);
});

test('apply modes are mutually exclusive and --write-receipt needs a receipt', () => {
  const ctx = confirmed();
  const both = run(APPLY, ['--run', ctx.runDir, '--generate', '--write-receipt'], { env: ctx.env });
  assert.equal(both.status, EXIT.usage);
  assert.match(both.stderr, /exactly one of --generate, --row, --write-receipt/);
  const none = run(APPLY, ['--run', ctx.runDir], { env: ctx.env });
  assert.equal(none.status, EXIT.usage);
  const missing = run(APPLY, ['--run', ctx.runDir, '--write-receipt'], { env: ctx.env });
  assert.equal(missing.status, EXIT.refused);
  assert.match(missing.stderr, /receipt\.md missing/);
});

test('the needs-a-decision rows the admin checks are applied like any other row', () => {
  const ctx = generated({ edits: [[`- [?] ${CALIB_DECISIONS[0]} `, (l) => l.replace('- [?] ', '- [x] ')]] });
  assert.equal(ctx.generate.rows_to_apply, 6);
  assert.ok(ctx.generate.rule_ids.includes(CALIB_DECISIONS[0]));
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, CALIB_DECISIONS[0]), 'applied');
  assert.equal(statusFor(ctx, CALIB_DECISIONS[1]), 'pending'); // still deferred, not skipped
  assert.equal(res.json.counts.applied, 6);
  assert.equal(res.json.counts.skipped, 0);
  assert.equal(res.json.counts.deferred_by_admin, 1);
});

// ---------------------------------------------------------------------------------------
// Stopping the loop for reasons other than an abort-class error

test('a --row that cannot run at all is attempted once, not once per row', () => {
  const ctx = generated();
  // The receipt is deleted after generate, so --row refuses with exit 2. Without the wider stop
  // set the remaining four rows would each repeat the same refusal and the report would too.
  rmSync(ctx.receipt);
  const res = apply(ctx, 'ok');
  assert.equal(res.status, EXIT.refused, res.stderr); // --write-receipt has no receipt either
  assert.deepEqual(updateLog(ctx.log), []); // no launcher call at all
  // Once for the first row, once for the final --write-receipt — not once per row.
  assert.equal((res.stderr.match(/receipt\.md missing/g) || []).length, 2);
});

test('a receipt from another run stops the loop on the first row', () => {
  const ctx = generated();
  writeFileSync(ctx.receipt, readText(ctx.receipt).replace(`run_id: ${ctx.runId}`, 'run_id: 19990101-000000'));
  const res = apply(ctx, 'ok');
  assert.equal(res.status, EXIT.refused);
  assert.deepEqual(updateLog(ctx.log), []);
  assert.equal((res.stderr.match(/does not match the run folder/g) || []).length, 2);
});

test('a stale script stops the loop and the report still prints, aborted', () => {
  const ctx = generated();
  // The admin unchecked row 3 after apply.sh was generated: --row refuses (exit 2), the loop
  // stops, and because the receipt is intact the final --write-receipt still reports.
  writeFileSync(ctx.receipt, readText(ctx.receipt).replace('- [x] 102 ', '- [ ] 102 '));
  const res = apply(ctx, 'ok');
  assert.equal(res.status, EXIT.report, res.stderr);
  assert.match(res.stderr, /rule 102 is not checked/);
  assert.match(res.stderr, /apply\.sh is stale/);
  // Rows 1-2 applied, the stale row and everything after it untouched.
  assert.deepEqual(updateLog(ctx.log).map((c) => c.rule_id), ['99', '101']);
  assert.equal(res.json.aborted, true);
  assert.deepEqual(res.json.non_applied.map((r) => [r.rule_id, r.status, r.code]), [
    [103, 'pending', null], [104, 'pending', null],
  ]);
  // 102 is now a skip, so it is no longer an apply row at all — it is counted as skipped.
  assert.equal(res.json.counts.skipped, 1);
  assert.equal(applyResults(ctx.runDir).filter((r) => r.status === 'aborted' && r.code === 'stale_script').length, 1);
});

test('a prose-only permission denial aborts the loop', () => {
  const ctx = generated();
  // The code is `unexpected_error`; only the message says it is a permission problem.
  const res = apply(ctx, 'forbidden_at:102');
  assert.equal(res.status, EXIT.report, res.stderr);
  assert.equal(res.json.aborted, true);
  assert.deepEqual(updateLog(ctx.log).map((c) => c.rule_id), ['99', '101', '102']);
  assert.equal(statusFor(ctx, 102), 'pending');
  assert.equal(applyResults(ctx.runDir).filter((r) => r.status === 'aborted' && r.code === 'unexpected_error').length, 1);
  assert.deepEqual(res.json.non_applied.map((r) => r.rule_id), [102, 103, 104]);
});

test('an abort on a row that already failed still reports aborted', () => {
  const ctx = generated();
  // First pass: 102 fails on validation.
  assert.equal(apply(ctx, 'fail:102:MT-VALIDATION').status, EXIT.report);
  assert.equal(statusFor(ctx, 102), 'failed(MT-VALIDATION)');
  // Resume: the same row now hits an auth error, so it keeps its old token but the loop stopped.
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.deepEqual(g.json.rule_ids, [102]);
  const res = apply(ctx, 'auth_at:102');
  assert.equal(res.status, EXIT.report, res.stderr);
  assert.equal(statusFor(ctx, 102), 'failed(MT-VALIDATION)'); // an abort adds no token
  assert.equal(res.json.aborted, true);
  assert.deepEqual(res.json.non_applied, [{ rule_id: 102, status: 'failed', code: 'not_logged_in' }]);
});

// ---------------------------------------------------------------------------------------
// Evidence that the write landed

test('a response that never names the severity applies but says it is unconfirmed', () => {
  const ctx = generated();
  const res = apply(ctx, 'nosev_at:101');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, 101), 'applied');
  assert.match(res.stderr, /rule 101 response carried no severity; verify will confirm/);
  const results = applyResults(ctx.runDir);
  assert.equal(results.find((r) => r.rule_id === 101).severity_verified, false);
  for (const r of results.filter((x) => x.rule_id !== 101)) assert.equal(r.severity_verified, true);
});

test('a severity found under a nested key still counts as confirmation', () => {
  for (const key of ['rule', 'result', 'data']) {
    const ctx = generated();
    const res = apply(ctx, `nested_at:101:${key}`);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(statusFor(ctx, 101), 'applied');
    assert.ok(!res.stderr.includes('carried no severity'), `severity under "${key}" must be found`);
    assert.equal(applyResults(ctx.runDir).find((r) => r.rule_id === 101).severity_verified, true);
  }
});

test('a nested severity that disagrees with the target is still a mismatch', () => {
  const ctx = generated();
  // `mismatch` answers at the top level; this pins the nested reader's comparison as well.
  const res = apply(ctx, 'mismatch:104');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 104), 'failed(response_mismatch)');
});

test('a success object with a non-zero exit is not read as applied', () => {
  const ctx = generated();
  const res = apply(ctx, 'exit1_at:101');
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 101), 'failed(non_zero_exit)');
  assert.deepEqual(res.json.non_applied, [{ rule_id: 101, status: 'failed', code: 'non_zero_exit' }]);
  assert.equal(appliedLedger(ctx).some((e) => e.rule_id === 101), false);
});

test('a row that never answers fails on the timeout', () => {
  const ctx = generated();
  const res = apply(ctx, 'hang_at:101:2000', { CALIBRATE_TIMEOUT_MS: '250' });
  assert.equal(res.status, EXIT.report);
  assert.equal(statusFor(ctx, 101), 'failed(timeout)');
  assert.equal(appliedLedger(ctx).some((e) => e.rule_id === 101), false);
  assert.equal(res.json.counts.applied, 4);
});

test('a rate limit seen only on stderr is retried, not failed', () => {
  const ctx = generated();
  const res = apply(ctx, 'ratelimit_stderr:102:2');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, 102), 'applied');
  assert.deepEqual(applyResults(ctx.runDir).filter((r) => r.rule_id === 102).map((r) => [r.attempt, r.status]), [
    [1, 'retrying'], [2, 'retrying'], [3, 'applied'],
  ]);
});

test('the backoff override is ignored unless CALIBRATE_TEST_MODE is set', () => {
  const ctx = generated();
  // Without the test-mode flag the base is 2 s, so one retry is enough to be measurable.
  const started = Date.now();
  const res = runScript(ctx, { FAKE_UPDATE_MODE: 'ratelimit:102:1', FAKE_UPDATE_LOG: ctx.log, FAKE_STATE: ctx.state, CALIBRATE_BACKOFF_MS: '1' });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statusFor(ctx, 102), 'applied');
  assert.ok(elapsed >= 2000, `expected the real 2 s backoff, waited ${elapsed} ms`);
});

// ---------------------------------------------------------------------------------------
// A stale apply.sh

test('--row refuses a target the receipt row does not name', () => {
  const ctx = generated();
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'error', '--qodo', FAKE_QODO], { env: { ...ctx.env, FAKE_UPDATE_LOG: ctx.log } });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /reads "recommendation" .* but apply\.sh asks for "error"/);
  assert.match(res.stderr, /apply\.sh is stale/);
  assert.deepEqual(updateLog(ctx.log), []); // nothing was sent
  // The refusal is recorded as an abort, so the run report names the row the loop stopped on.
  assert.deepEqual(applyResults(ctx.runDir).map((r) => [r.rule_id, r.status, r.code, r.attempt]), [[99, 'aborted', 'stale_script', 0]]);
});

test('--row refuses a row the admin unchecked after the script was generated', () => {
  const ctx = generated();
  writeFileSync(ctx.receipt, readText(ctx.receipt).replace('- [x] 99 ', '- [ ] 99 '));
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'recommendation', '--qodo', FAKE_QODO], { env: { ...ctx.env, FAKE_UPDATE_LOG: ctx.log } });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /is not checked in .*receipt\.md/);
  assert.deepEqual(updateLog(ctx.log), []);
});

test('--row refuses a row the receipt already marks skipped', () => {
  const ctx = generated();
  writeFileSync(ctx.receipt, readText(ctx.receipt).replace(/(- \[x\] 99 .*)$/m, '$1 · skipped'));
  const res = run(APPLY, ['--run', ctx.runDir, '--row', '99', '--target', 'recommendation', '--qodo', FAKE_QODO], { env: { ...ctx.env, FAKE_UPDATE_LOG: ctx.log } });
  assert.equal(res.status, EXIT.refused);
  assert.match(res.stderr, /already `· skipped`/);
  assert.deepEqual(updateLog(ctx.log), []);
});

test('--generate never puts a skipped row back in the script', () => {
  // 105 is explicitly skipped (not deferred), so the receipt carries its `· skipped` token.
  const ctx = generated({ edits: [['- [?] 105 ', (l) => l.replace('- [?] ', '- [ ] ')]] });
  // The admin ticked a row back on after it was marked skipped: the token wins.
  writeFileSync(ctx.receipt, readText(ctx.receipt).replace(/(- \[ \] 105 .*?) · skipped$/m, '- [x] 105 $1 · skipped').replace('- [x] 105 - [ ] 105 ', '- [x] 105 '));
  const marked = readText(ctx.receipt).split('\n').find((l) => l.includes('] 105 '));
  assert.ok(marked.startsWith('- [x] 105 ') && marked.endsWith(' · skipped'), marked);
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.rows_to_apply, 5);
  assert.equal(g.json.rule_ids.includes(105), false);
  assert.deepEqual(g.json.already_skipped, [105]);
});

// ---------------------------------------------------------------------------------------
// Generate: a missing receipt, an unreadable proposal, and the skips

test('--generate rebuilds a deleted receipt from the results rather than re-sending rows', () => {
  const ctx = generated();
  assert.equal(apply(ctx, 'fail:103:MT-VALIDATION').status, EXIT.report);
  rmSync(ctx.receipt); // the admin (or a cleanup script) removed it; the results survive
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.source, 'proposal.md');
  assert.match(g.json.warnings.join(' '), /was missing while .*apply-results\.jsonl holds 5 recorded attempt\(s\)/);
  assert.deepEqual(g.json.already_applied, [99, 101, 102, 104]);
  assert.deepEqual(g.json.rule_ids, [103]);
  const secondLog = join(ctx.runDir, 'rebuilt-log.jsonl');
  const res = runScript(ctx, { FAKE_UPDATE_MODE: 'ok', FAKE_UPDATE_LOG: secondLog, ...FAST });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(updateLog(secondLog).map((c) => c.rule_id), ['103']);
});

test('--generate resumes past a proposal.md that is unreadable or from another run', () => {
  const ctx = generated();
  assert.equal(apply(ctx, 'fail:103:MT-VALIDATION').status, EXIT.report);
  writeFileSync(ctx.proposal, readText(ctx.proposal).replace(`run_id: ${ctx.runId}`, 'run_id: 19990101-000000'));
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.source, 'receipt.md');
  assert.match(g.json.warnings.join(' '), /proposal\.md unreadable or belongs to another run — ignored/);
  assert.deepEqual(g.json.rule_ids, [103]);

  // The same holds for frontmatter that is gone entirely.
  writeFileSync(ctx.proposal, readText(ctx.proposal).replace('---\n', ''));
  const g2 = generate(ctx);
  assert.equal(g2.status, 0, g2.stderr);
  assert.match(g2.json.warnings.join(' '), /proposal\.md unreadable or belongs to another run — ignored/);
});

test('--generate records the admin\'s skips itself, and adds none when they are on record', () => {
  const ctx = confirmed({ edits: [['- [x] 104 ', uncheck]] });
  // --record-skips was never run: generate must still put the skips on record.
  assert.deepEqual(ledgerLines(ctx.ledger), []);
  const g = generate(ctx);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.json.skips_recorded, 1); // only the explicit skip; the deferred rows are not
  assert.deepEqual(skipLedger(ctx).map((e) => e.rule_id).sort((a, b) => a - b), [104]);
  for (const entry of skipLedger(ctx)) {
    assert.equal(entry.run_id, ctx.runId);
    assert.ok(entry.content_hash.startsWith('sha256:'));
  }
  // Regenerating adds nothing, and neither does the documented --record-skips step.
  assert.equal(generate(ctx).json.skips_recorded, 0);
  const record = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(record.status, 0, record.stderr);
  assert.equal(record.json.recorded, 0);
  assert.equal(record.json.status, 'already_recorded');
  assert.equal(skipLedger(ctx).length, 1);
});

test('--write-receipt reports the invalid rows alongside the counts', () => {
  const ctx = generated({ edits: [['- [x] 102 ', retarget('critical')]] });
  const res = apply(ctx, 'ok');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.counts.invalid, 1);
  assert.equal(res.json.invalid.length, 1);
  assert.equal(res.json.invalid[0].rule_id, 102);
  assert.match(res.json.invalid[0].reason, /"critical" is not a severity/);
  assert.ok(Number.isInteger(res.json.invalid[0].line));
});
