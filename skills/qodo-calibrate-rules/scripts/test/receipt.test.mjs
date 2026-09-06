import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRow } from '../lib/proposal-lib.mjs';
import {
  DEFAULT_UPDATE_ARGS, EXIT, REVERT_SCRIPT_FILE, SKILL_VERSION, STOP_CODES, applyPhaseState, applyState,
  effectiveStatus, foldResults, idempotencyKey, markRows, parseReceipt, readResults,
  renderApplyScript, setFrontmatter, shq, splitStatus, statusToken, stripStatuses, updateArgv,
} from '../lib/receipt-lib.mjs';
import { tmp } from './helpers.mjs';

const ROW = '- [x] 104 · Never log session tokens · Do not write raw tokens to logs · warning → error · guard: token, secret · https://portal.example.com/rules/104';
const PLAIN = '- [ ] 105 · Document encryption-key helpers · Naming the key source · warning → recommendation · guard: encrypt · https://app.qodo.ai/rules/105';

test('splitStatus round-trips a row with a guard list and no token', () => {
  const { row, statuses } = splitStatus(ROW);
  assert.equal(row, ROW);
  assert.deepEqual(statuses, []);
  assert.equal(effectiveStatus(statuses), 'pending');
  assert.equal(parseRow(row).ok, true);
  assert.deepEqual(parseRow(row).guard_hits, ['token', 'secret']);
});

test('splitStatus strips accumulated tokens and keeps them in file order', () => {
  const line = `${ROW} · failed(MT-VALIDATION) · applied`;
  const { row, statuses } = splitStatus(line);
  assert.equal(row, ROW);
  assert.deepEqual(statuses, ['failed(MT-VALIDATION)', 'applied']);
  assert.equal(effectiveStatus(statuses), 'applied');
  assert.equal(effectiveStatus(line), 'applied');
  // The stripped row still parses; the raw line does not, because the row grammar is
  // right-anchored on the url — proof that a token must always be stripped first.
  assert.equal(parseRow(row).ok, true);
  assert.equal(parseRow(row).url, 'https://portal.example.com/rules/104');
  assert.equal(parseRow(line).ok, false);
  assert.equal(parseRow(line).reason, 'unparseable row');
});

test('splitStatus handles every token in the vocabulary, apply and verify alike', () => {
  for (const token of ['applied', 'failed(MT-NOT-FOUND)', 'deferred', 'skipped', 'verified', 'mismatch(warning)', 'reverted']) {
    const { row, statuses } = splitStatus(`${PLAIN} · ${token}`);
    assert.equal(row, PLAIN);
    assert.deepEqual(statuses, [token]);
    assert.equal(effectiveStatus(statuses), token);
  }
});

test('stripStatuses leaves headings, frontmatter, and prose untouched', () => {
  const text = ['---', 'run_id: r', '---', '', '## Decrease → recommendation · documentation (1) — pre-checked; uncheck to skip', `${PLAIN} · skipped`, '', '---', 'Held by prior decision: 0 rules'].join('\n');
  const stripped = stripStatuses(text);
  assert.ok(stripped.includes(PLAIN));
  assert.ok(!stripped.includes('· skipped'));
  assert.ok(stripped.includes('## Decrease → recommendation · documentation (1) — pre-checked; uncheck to skip'));
  assert.ok(stripped.includes('Held by prior decision: 0 rules'));
});

test('parseReceipt reports each row\'s tokens, effective status, and line number', () => {
  const text = ['---', 'run_id: r', '---', '', `${ROW} · applied`, PLAIN, '- [x] nope', ''].join('\n');
  const parsed = parseReceipt(text);
  assert.equal(parsed.error, null);
  assert.equal(parsed.frontmatter.run_id, 'r');
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows.map((r) => [r.rule_id, r.status, r.line]), [[104, 'applied', 5], [105, 'pending', 6], [null, 'pending', 7]]);
  assert.equal(parsed.rows[2].ok, false);
});

test('statusToken maps only the terminal result statuses', () => {
  assert.equal(statusToken({ status: 'applied' }), 'applied');
  assert.equal(statusToken({ status: 'failed', code: 'MT-VALIDATION' }), 'failed(MT-VALIDATION)');
  assert.equal(statusToken({ status: 'failed' }), 'failed(unknown)');
  assert.equal(statusToken({ status: 'deferred' }), 'deferred');
  // An abort leaves the row pending, and a retry is only an attempt, so neither marks the row.
  assert.equal(statusToken({ status: 'aborted', code: 'not_logged_in' }), null);
  assert.equal(statusToken({ status: 'retrying', code: 'MT-RATE-LIMITED' }), null);
});

test('foldResults writes the last result per rule and is idempotent', () => {
  const text = ['---', 'run_id: r', '---', '', ROW, PLAIN, ''].join('\n');
  const results = [
    { rule_id: 104, status: 'retrying', code: 'MT-RATE-LIMITED', attempt: 1 },
    { rule_id: 104, status: 'applied', attempt: 2 },
  ];
  const once = foldResults(text, results);
  assert.equal(once.changed, 1);
  assert.ok(once.text.includes(`${ROW} · applied`));
  assert.ok(once.text.includes(`${PLAIN}\n`)); // no result, no token
  const twice = foldResults(once.text, results);
  assert.equal(twice.changed, 0);
  assert.equal(twice.text, once.text);
});

test('foldResults accumulates a second token when the status changed on a resume', () => {
  const text = ['---', 'run_id: r', '---', '', `${ROW} · failed(MT-VALIDATION)`, ''].join('\n');
  const folded = foldResults(text, [{ rule_id: 104, status: 'applied' }]);
  assert.equal(folded.changed, 1);
  assert.ok(folded.text.includes(`${ROW} · failed(MT-VALIDATION) · applied`));
  assert.equal(effectiveStatus(splitStatus(`${ROW} · failed(MT-VALIDATION) · applied`).statuses), 'applied');
});

test('foldResults leaves a pending row pending when the last result is an abort', () => {
  const text = ['---', 'run_id: r', '---', '', ROW, ''].join('\n');
  const folded = foldResults(text, [{ rule_id: 104, status: 'aborted', code: 'not_logged_in' }]);
  assert.equal(folded.changed, 0);
  assert.ok(folded.text.includes(`${ROW}\n`));
});

test('markRows only tokens the named rows that carry no token yet', () => {
  const text = ['---', 'run_id: r', '---', '', `${ROW} · applied`, PLAIN, ''].join('\n');
  const marked = markRows(text, [104, 105], 'skipped');
  assert.equal(marked.changed, 1);
  assert.ok(marked.text.includes(`${ROW} · applied`));
  assert.ok(marked.text.includes(`${PLAIN} · skipped`));
});

test('readResults skips a half-written line and keeps the rest', () => {
  const dir = tmp('results-');
  const path = join(dir, 'apply-results.jsonl');
  writeFileSync(path, `${JSON.stringify({ rule_id: 1, status: 'applied' })}\n{"rule_id":2,"stat\n${JSON.stringify({ status: 'applied' })}\n\n${JSON.stringify({ rule_id: 3, status: 'deferred' })}\n`);
  const warnings = [];
  const results = readResults(path, (m) => warnings.push(m));
  assert.deepEqual(results.map((r) => r.rule_id), [1, 3]);
  assert.equal(warnings.length, 2);
  assert.deepEqual(readResults(join(dir, 'nope.jsonl')), []);
});

test('setFrontmatter inserts new keys before the rubric block and replaces existing ones', () => {
  const text = ['---', 'run_id: r', 'proposed: 5', 'rubric: |', '  version: 1', '  severities:', '---', '', ROW, ''].join('\n');
  const once = setFrontmatter(text, { applied_at: '2026-09-02T20:10:00.000Z', apply_exit_code: 3 });
  const lines = once.split('\n');
  assert.deepEqual(lines.slice(0, 7), ['---', 'run_id: r', 'proposed: 5', 'applied_at: 2026-09-02T20:10:00.000Z', 'apply_exit_code: 3', 'rubric: |', '  version: 1']);
  assert.equal(parseReceipt(once).frontmatter.rubric, 'version: 1\nseverities:\n');
  const twice = setFrontmatter(once, { apply_exit_code: 0 });
  assert.equal(twice.split('\n').filter((l) => l.startsWith('apply_exit_code:')).length, 1);
  assert.equal(parseReceipt(twice).frontmatter.apply_exit_code, '0');
  assert.equal(parseReceipt(twice).frontmatter.applied_at, '2026-09-02T20:10:00.000Z');
  assert.equal(setFrontmatter(text, {}), text);
});

test('setFrontmatter refuses a file with no frontmatter', () => {
  assert.throws(() => setFrontmatter(`${ROW}\n`, { apply_exit_code: 0 }), /no frontmatter/);
  assert.throws(() => setFrontmatter('---\nrun_id: r\n', { apply_exit_code: 0 }), /not terminated/);
});

test('shq quotes for POSIX double quotes', () => {
  assert.equal(shq('/tmp/a b/qodo'), '"/tmp/a b/qodo"');
  assert.equal(shq('/tmp/$HOME/`x`/"q"\\z'), '"/tmp/\\$HOME/\\`x\\`/\\"q\\"\\\\z"');
});

test('updateArgv is exactly the one write this skill makes', () => {
  assert.deepEqual(updateArgv({ updateArgs: ['rules', 'update'], ruleId: 104, target: 'error', runId: '20260902-190914' }), [
    'rules', 'update', '--rule-id', '104', '--severity', 'error', '--json', '--idempotency-key', 'calibrate-20260902-190914-104',
  ]);
  assert.equal(idempotencyKey('20260902-190914', 104), 'calibrate-20260902-190914-104');
});

test('renderApplyScript emits the documented shape', () => {
  const script = renderApplyScript({
    runDir: '/runs/20260902-190914',
    scriptsDir: '/skill/scripts',
    launcher: '/bin/qodo',
    runId: '20260902-190914',
    rows: [{ rule_id: 99, target: 'recommendation' }, { rule_id: 104, target: 'error' }],
    node: '/opt/node/bin/node',
    now: new Date('2026-09-02T20:10:00Z'),
  });
  const lines = script.split('\n');
  assert.equal(lines[0], '#!/bin/sh');
  assert.equal(lines[1], `# qodo-calibrate-rules ${SKILL_VERSION} · run 20260902-190914 · 2 rows · generated 2026-09-02T20:10:00.000Z · do not edit`);
  assert.ok(lines.includes('set -u'));
  assert.ok(!script.includes('set -e')); // a failed or deferred row must not stop the loop
  assert.equal(lines[4], 'ABORTED=0');
  // The interpreter is the absolute process.execPath, never the bare word `node`: a
  // non-interactive sh may have no node on PATH, and every row would then fail with 127.
  assert.equal(lines[5], `row() { [ "$ABORTED" -eq 1 ] && return 0; "/opt/node/bin/node" "/skill/scripts/apply.mjs" --run "/runs/20260902-190914" --qodo "/bin/qodo" --row "$1" --target "$2"; rc=$?; case "$rc" in ${STOP_CODES.join('|')}) ABORTED=1 ;; *) if [ "$rc" -gt 128 ]; then ABORTED=1; fi ;; esac; return 0; }`);
  assert.ok(!/(?:^|[^\w/"])node /.test(lines[5]), 'no bare `node` in the row function');
  assert.equal(lines[6], 'row 99 recommendation    # qodo rules update --rule-id 99 --severity recommendation --json --idempotency-key calibrate-20260902-190914-99');
  assert.equal(lines[7], 'row 104 error    # qodo rules update --rule-id 104 --severity error --json --idempotency-key calibrate-20260902-190914-104');
  assert.equal(lines[8], 'exec "/opt/node/bin/node" "/skill/scripts/apply.mjs" --run "/runs/20260902-190914" --write-receipt');
  assert.ok(!script.includes('exit 30')); // an abort stops the rows, not the report
});

test('the stop codes cover every way --row can fail to run at all', () => {
  // 30 abort, 1 usage / Node too old, 2 refused (no receipt, wrong run, stale script),
  // 126 not executable, 127 interpreter not found. Anything over 128 is caught by the -gt test.
  assert.deepEqual(STOP_CODES, [EXIT.abort, EXIT.usage, EXIT.refused, 126, 127]);
  const script = renderApplyScript({ runDir: '/r', scriptsDir: '/s', launcher: 'q', runId: 'r', rows: [{ rule_id: 1, target: 'error' }] });
  assert.ok(script.includes(`case "$rc" in ${STOP_CODES.join('|')})`), 'every stop code is in the case arm');
  assert.ok(script.includes('-gt 128'), 'signal deaths stop the loop too');
  // The script still ends in --write-receipt, so a stopped loop always produces a report.
  assert.match(script.trimEnd(), /--write-receipt$/);
});

test('renderApplyScript defaults the interpreter to this process', () => {
  const script = renderApplyScript({ runDir: '/r', scriptsDir: '/s', launcher: 'q', runId: 'r', rows: [] });
  assert.ok(script.includes(`"${process.execPath}"`), 'process.execPath is embedded');
});

test('renderApplyScript carries a non-default command path through to --row', () => {
  const script = renderApplyScript({
    runDir: '/runs/r', scriptsDir: '/s', launcher: '/bin/qodo', updateArgs: 'write rules update', runId: 'r',
    rows: [{ rule_id: 7, target: 'error' }],
  });
  assert.ok(script.includes('--update-args "write rules update" --row "$1"'));
  assert.ok(script.includes('# qodo write rules update --rule-id 7 --severity error --json --idempotency-key calibrate-r-7'));
  assert.ok(!renderApplyScript({ runDir: '/r', scriptsDir: '/s', launcher: 'q', updateArgs: ` ${DEFAULT_UPDATE_ARGS} `, runId: 'r', rows: [] }).includes('--update-args'));
});

test('a row whose own text reads like a token is left untouched', () => {
  // Stripping is right-anchored, so a name that is exactly a token word survives.
  for (const word of ['applied', 'deferred', 'skipped', 'reverted', 'verified']) {
    const row = `- [x] 77 · A rule named ${word} · ${word} · warning → error · https://app.qodo.ai/rules/77`;
    const { row: stripped, statuses } = splitStatus(row);
    assert.equal(stripped, row, `row containing "${word}" must not be stripped`);
    assert.deepEqual(statuses, []);
    assert.equal(parseRow(stripped).ok, true);
    assert.equal(parseRow(stripped).rule_id, 77);
    // …and it still gains a real token at the end, without losing its own text.
    const folded = foldResults(['---', 'run_id: r', '---', '', row, ''].join('\n'), [{ rule_id: 77, status: 'applied' }]);
    assert.equal(folded.changed, 1);
    assert.ok(folded.text.includes(`${row} · applied`));
    assert.equal(effectiveStatus(splitStatus(`${row} · applied`).statuses), 'applied');
  }
});

test('a token run is only stripped when it is the whole tail of the line', () => {
  const row = '- [x] 78 · n · s · warning → error · https://app.qodo.ai/rules/78';
  // Three accumulated tokens come off together, in order.
  assert.deepEqual(splitStatus(`${row} · failed(MT-VALIDATION) · deferred · applied`).statuses, ['failed(MT-VALIDATION)', 'deferred', 'applied']);
  // A token followed by more row text is part of the row, not a status.
  const notATail = `${row} · applied · https://app.qodo.ai/rules/78`;
  assert.deepEqual(splitStatus(notATail).statuses, []);
  assert.equal(splitStatus(notATail).row, notATail);
});

test('a CRLF receipt folds, marks, and parses without stray carriage returns', () => {
  const row = '- [x] 79 · n · s · warning → error · https://app.qodo.ai/rules/79';
  const skip = '- [ ] 80 · n · s · warning → recommendation · https://app.qodo.ai/rules/80';
  const text = ['---', 'run_id: r', '---', '', row, skip, ''].join('\r\n');

  const folded = foldResults(text, [{ rule_id: 79, status: 'applied' }]);
  assert.equal(folded.changed, 1);
  assert.ok(folded.text.includes(`${row} · applied\r`), 'the token goes before the carriage return');
  assert.ok(!folded.text.includes('\r · applied'));

  const marked = markRows(folded.text, [80], 'skipped');
  assert.equal(marked.changed, 1);
  assert.ok(marked.text.includes(`${skip} · skipped\r`));

  const parsed = parseReceipt(marked.text);
  assert.deepEqual(parsed.rows.map((r) => [r.rule_id, r.status, r.ok]), [[79, 'applied', true], [80, 'skipped', true]]);
  // Every row the readback will see parses, with no carriage return left inside it.
  for (const line of stripStatuses(marked.text).split(/\r?\n/).filter((l) => l.startsWith('- ['))) {
    assert.equal(parseRow(line).ok, true, line);
    assert.ok(!line.includes('\r'));
  }
});

// ---------------------------------------------------------------------------------------
// The revert script

test('renderApplyScript in revert mode differs from apply in exactly four places', () => {
  const rows = [{ rule_id: 99, target: 'error' }, { rule_id: 104, target: 'warning' }];
  const common = {
    runDir: '/runs/20260902-190914',
    scriptsDir: '/skill/scripts',
    launcher: '/bin/qodo',
    runId: '20260902-190914',
    rows,
    node: '/opt/node/bin/node',
    now: new Date('2026-09-02T20:10:00Z'),
  };
  const apply = renderApplyScript(common).split('\n');
  const revert = renderApplyScript({ ...common, mode: 'revert' }).split('\n');
  assert.equal(revert.length, apply.length);
  // 1. the header word
  assert.equal(revert[1], `# qodo-calibrate-rules ${SKILL_VERSION} · run 20260902-190914 · revert · 2 rows · generated 2026-09-02T20:10:00.000Z · do not edit`);
  assert.equal(revert[2], `# One Bash invocation reverts the whole batch: sh ${REVERT_SCRIPT_FILE}. Never run the rows by hand.`);
  // 2. --revert on the row call — the rest of the row function is byte-identical
  assert.equal(revert[5], apply[5].replace('--target "$2"', '--target "$2" --revert'));
  // 3. the per-row comment's key, and 4. --revert on the final --write-receipt
  assert.equal(revert[6], 'row 99 error    # qodo rules update --rule-id 99 --severity error --json --idempotency-key calibrate-revert-20260902-190914-99');
  assert.equal(revert[7], 'row 104 warning    # qodo rules update --rule-id 104 --severity warning --json --idempotency-key calibrate-revert-20260902-190914-104');
  assert.equal(revert[8], `${apply[8]} --revert`);
  // Everything else is the same script: same shebang, same set -u, same ABORTED, no set -e.
  for (const i of [0, 3, 4]) assert.equal(revert[i], apply[i]);
  assert.ok(!revert.join('\n').includes('set -e'));
});

test('the revert idempotency key is never the apply key', () => {
  // A server that replayed the cached response for the apply key would answer a revert with the
  // apply's result, and the revert would look like it had worked.
  assert.equal(idempotencyKey('20260902-190914', 104, 'revert'), 'calibrate-revert-20260902-190914-104');
  assert.equal(idempotencyKey('20260902-190914', 104, 'apply'), 'calibrate-20260902-190914-104');
  assert.equal(idempotencyKey('20260902-190914', 104), 'calibrate-20260902-190914-104');
  assert.deepEqual(updateArgv({ updateArgs: ['rules', 'update'], ruleId: 104, target: 'warning', runId: 'r1', mode: 'revert' }), [
    'rules', 'update', '--rule-id', '104', '--severity', 'warning', '--json', '--idempotency-key', 'calibrate-revert-r1-104',
  ]);
});

test('statusToken tokenises the verify and revert result statuses', () => {
  assert.equal(statusToken({ status: 'verified' }), 'verified');
  assert.equal(statusToken({ status: 'mismatch', actual: 'warning' }), 'mismatch(warning)');
  // An actual that is absent, blank, or carries a character that would break the token grammar
  // becomes `unknown`: the row still says the workspace disagreed, and it still parses.
  assert.equal(statusToken({ status: 'mismatch' }), 'mismatch(unknown)');
  assert.equal(statusToken({ status: 'mismatch', actual: '' }), 'mismatch(unknown)');
  assert.equal(statusToken({ status: 'mismatch', actual: null }), 'mismatch(unknown)');
  assert.equal(statusToken({ status: 'mismatch', actual: 'weird)severity' }), 'mismatch(unknown)');
  assert.equal(statusToken({ status: 'mismatch', actual: 'a · b' }), 'mismatch(unknown)');
  assert.equal(statusToken({ status: 'mismatch', actual: 'two\nlines' }), 'mismatch(unknown)');
  // A token built from any of those still strips cleanly, which is the property that matters.
  for (const actual of ['warning', '', 'weird)severity', 'a · b']) {
    const token = statusToken({ status: 'mismatch', actual });
    assert.equal(splitStatus(`- [x] 1 · n · s · warning → error · https://x/1 · ${token}`).statuses.length, 1, `strips ${token}`);
  }
  assert.equal(statusToken({ status: 'reverted' }), 'reverted');
  // A revert-phase failure or exhausted retry stays inside the failed(…) grammar and keeps the
  // apply state `applied`, so the next --generate --revert picks the row up again.
  assert.equal(statusToken({ status: 'failed', code: 'MT-VALIDATION', phase: 'revert' }), 'failed(revert:MT-VALIDATION)');
  assert.equal(statusToken({ status: 'deferred', code: 'MT-RATE-LIMITED', phase: 'revert' }), 'failed(revert:MT-RATE-LIMITED)');
  assert.equal(statusToken({ status: 'failed', code: 'MT-VALIDATION', phase: 'apply' }), 'failed(MT-VALIDATION)');
  assert.equal(statusToken({ status: 'deferred', phase: 'apply' }), 'deferred');
  assert.equal(statusToken({ status: 'aborted' }), null);
});

test('the apply-phase view and the "where is the rule now" view are separate', () => {
  // applyState answers "where is the rule now?" — a revert token is the latest word on that.
  // applyPhaseState answers "what did the apply loop do?" — it must ignore both later classes, so
  // the apply report never counts a row as not-applied because a *revert* touched it afterwards.
  const cases = [
    [['applied'], 'applied', 'applied'],
    [['applied', 'verified'], 'applied', 'applied'],
    [['applied', 'failed(revert:MT-VALIDATION)'], 'applied', 'applied'],
    [['applied', 'verified', 'reverted'], 'reverted', 'applied'],
    [['failed(MT-VALIDATION)'], 'failed', 'failed'],
    [['failed(non_zero_exit)', 'mismatch(error)'], 'failed', 'failed'],
    [['skipped'], 'skipped', 'skipped'],
    [['deferred'], 'deferred', 'deferred'],
    [[], 'pending', 'pending'],
  ];
  for (const [statuses, now, duringApply] of cases) {
    assert.equal(applyState(statuses), now, `applyState ${statuses.join(' · ')}`);
    assert.equal(applyPhaseState(statuses), duringApply, `applyPhaseState ${statuses.join(' · ')}`);
  }
});
