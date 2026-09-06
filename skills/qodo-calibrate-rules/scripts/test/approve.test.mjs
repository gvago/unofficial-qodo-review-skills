import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash } from '../lib/ledger-lib.mjs';
import {
  APPROVE, CALIB_DECISIONS, CALIB_PRECHECKED, CALIB_RULES, CALIB_TAGS, LEDGER,
  PROPOSAL, ledgerLines, makeCalibrated, proposalRows, readText, run,
} from './helpers.mjs';

const RENDERED = [...CALIB_PRECHECKED, ...CALIB_DECISIONS];

// A run with proposal.md rendered from the fixture batch.
function proposed() {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  const r = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1'], { env: ctx.env });
  assert.equal(r.status, 0, r.stderr);
  ctx.proposal = join(ctx.runDir, 'proposal.md');
  return ctx;
}

// Rewrite proposal.md by applying `edit` to each line.
function edit(ctx, edits) {
  const text = readText(ctx.proposal).split('\n').flatMap((line) => {
    for (const [match, replace] of edits) {
      if (line.startsWith(match)) return replace === null ? [] : [replace];
    }
    return [line];
  }).join('\n');
  writeFileSync(ctx.proposal, text);
}

function readback(ctx) {
  const res = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  return res.json;
}

function lineOf(ctx, ruleId) {
  return proposalRows(readText(ctx.proposal)).find((r) => r.text.startsWith(`- [x] ${ruleId} ·`) || r.text.startsWith(`- [ ] ${ruleId} ·`) || r.text.startsWith(`- [?] ${ruleId} ·`)).line;
}

test('an unedited proposal reads back as all approve plus the needs-a-decision defers', () => {
  const ctx = proposed();
  const rb = readback(ctx);
  assert.deepEqual(rb.counts, { approve: 5, skip: 0, defer: 2, override: 0, invalid: 0, removed: 0 });
  assert.equal(rb.counts.approve, 5); // frontmatter proposed
  assert.equal(rb.counts.defer, CALIB_DECISIONS.length);
  assert.deepEqual(rb.invalid, []);
  assert.equal(rb.readback_text, '5 approve · 0 skip · 2 deferred · 0 override · 0 invalid override');
  assert.deepEqual(rb.rows.map((r) => r.rule_id), [99, 101, 102, 103, 104, 105, 106]);
  for (const row of rb.rows) {
    assert.equal(row.decision, CALIB_DECISIONS.includes(row.rule_id) ? 'defer' : 'approve');
    assert.ok(Number.isInteger(row.line));
    assert.ok(['error', 'warning', 'recommendation'].includes(row.current));
    assert.ok(['error', 'warning', 'recommendation'].includes(row.target));
  }
  assert.equal(ledgerLines(ctx.ledger).length, 0); // readback writes nothing
});

test('unchecking, editing a target, and checking a needs-a-decision row read back as skip, override, approve', () => {
  const ctx = proposed();
  edit(ctx, [
    ['- [x] 99 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 99 ·')).replace('- [x]', '- [ ]')],
    ['- [x] 102 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 102 ·')).replace('error → recommendation', 'error → warning')],
    ['- [?] 105 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [?] 105 ·')).replace('- [?]', '- [x]')],
  ]);
  const rb = readback(ctx);
  assert.deepEqual(rb.counts, { approve: 4, skip: 1, defer: 1, override: 1, invalid: 0, removed: 0 });
  const by = Object.fromEntries(rb.rows.map((r) => [r.rule_id, r]));
  assert.equal(by[99].decision, 'skip');
  assert.equal(by[102].decision, 'override');
  assert.equal(by[102].target, 'warning');
  assert.equal(by[105].decision, 'approve');
  assert.equal(by[106].decision, 'defer');
  assert.equal(rb.readback_text, '4 approve · 1 skip · 1 deferred · 1 override · 0 invalid override');
});

test('an invalid override is listed by line with its reason and excluded', () => {
  const ctx = proposed();
  const line103 = lineOf(ctx, 103);
  const line104 = lineOf(ctx, 104);
  edit(ctx, [
    ['- [x] 103 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 103 ·')).replace('warning → recommendation', 'warning → critical')],
    ['- [x] 104 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 104 ·')).replace('warning → error', 'warning → warning')],
  ]);
  const rb = readback(ctx);
  assert.equal(rb.counts.invalid, 2);
  assert.equal(rb.counts.approve, 3);
  assert.deepEqual(rb.invalid.map((i) => [i.line, i.rule_id, i.reason]), [
    [line103, 103, '"critical" is not a severity'],
    [line104, 104, '"warning" equals current severity'],
  ]);
  assert.equal(rb.readback_text, `3 approve · 0 skip · 2 deferred · 0 override · 2 invalid override (rows ${line103}: "critical" is not a severity; rows ${line104}: "warning" equals current severity)`);
  assert.ok(!rb.rows.some((r) => r.rule_id === 103 || r.rule_id === 104));
});

test('a mangled row is invalid by line number and leaves the other rows alone', () => {
  const ctx = proposed();
  const line = lineOf(ctx, 106);
  edit(ctx, [['- [?] 106 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [?] 106 ·')).replace(' · https://', ' https://')]]);
  const rb = readback(ctx);
  assert.equal(rb.counts.invalid, 1);
  assert.equal(rb.counts.approve, 5);
  assert.equal(rb.counts.skip, 0);
  assert.equal(rb.counts.defer, 1);
  assert.deepEqual(rb.invalid.map((i) => [i.line, i.reason]), [[line, 'unparseable row']]);
  assert.equal(rb.readback_text, `5 approve · 0 skip · 1 deferred · 0 override · 1 invalid override (rows ${line}: unparseable row)`);
});

test('rows deleted from the file are counted as removed and excluded', () => {
  const ctx = proposed();
  edit(ctx, [['- [x] 104 ·', null], ['- [?] 105 ·', null]]);
  const rb = readback(ctx);
  assert.equal(rb.counts.removed, 2);
  assert.deepEqual(rb.removed_ids, [104, 105]);
  assert.equal(rb.counts.approve, 4);
  assert.equal(rb.counts.skip, 0);
  assert.equal(rb.counts.defer, 1);
  assert.ok(!rb.rows.some((r) => r.rule_id === 104));
});

test('a duplicate row id and an unknown row id are both invalid', () => {
  const ctx = proposed();
  const text = readText(ctx.proposal);
  const row104 = text.split('\n').find((l) => l.startsWith('- [x] 104 ·'));
  writeFileSync(ctx.proposal, text.replace(row104, `${row104}\n${row104}`).replace('- [x] 103 ·', '- [x] 4242 ·'));
  const rb = readback(ctx);
  assert.equal(rb.counts.invalid, 3);
  assert.deepEqual(rb.invalid.map((i) => i.reason).sort(), ['duplicate rule id 104', 'duplicate rule id 104', 'rule 4242 was not proposed in this run']);
  assert.ok(!rb.rows.some((r) => r.rule_id === 104));
  assert.deepEqual(rb.removed_ids, [103]);
});

test('a proposal from another run, or no proposal at all, is refused', () => {
  const ctx = proposed();
  writeFileSync(ctx.proposal, readText(ctx.proposal).replace(`run_id: ${ctx.runId}`, 'run_id: 20991231-235959'));
  const res = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the run folder/);
  const fresh = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  const none = run(APPROVE, ['--run', fresh.runDir, '--readback'], { env: fresh.env });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /proposal\.md missing — render the proposal first/);
});

test('--record-skips appends the skipped rows and holds them on the next render', () => {
  const ctx = proposed();
  edit(ctx, [['- [x] 99 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 99 ·')).replace('- [x]', '- [ ]')]]);
  const first = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.status, 'recorded');
  assert.equal(first.json.recorded, 1);
  assert.deepEqual(first.json.rule_ids, [99]); // 105 and 106 are deferred, never recorded
  assert.deepEqual(first.json.warnings, []);
  const entries = ledgerLines(ctx.ledger);
  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]), ['rule_id', 'decision', 'severity_at_decision', 'content_hash', 'run_id', 'decided_at']);
  assert.equal(entries[0].decision, 'skip');
  assert.equal(entries[0].severity_at_decision, 'error'); // rule 99 sits at error
  assert.match(entries[0].content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(entries[0].run_id, ctx.runId);
  assert.match(entries[0].decided_at, /^\d{4}-\d\d-\d\dT/);

  const second = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.status, 'already_recorded');
  assert.equal(second.json.recorded, 0);
  assert.equal(ledgerLines(ctx.ledger).length, 1);

  // a readback after recording is unchanged: the rows are still in the file
  const rb = readback(ctx);
  assert.equal(rb.counts.skip, 1);
  assert.equal(rb.counts.defer, 2);
  assert.equal(rb.counts.removed, 0);

  // a new run over the same rules proposes none of them
  const nextRun = join(ctx.calibrate, 'runs', '20260102-000000');
  cpSync(ctx.runDir, nextRun, { recursive: true });
  const rendered = run(PROPOSAL, ['--run', nextRun, '--render', '--workspace-id', 'ws-1', '--replace'], { env: ctx.env });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.json.held_by_prior_decision, 1);
  assert.equal(rendered.json.rows, 6);
  const text = readText(join(nextRun, 'proposal.md'));
  assert.ok(!text.includes(' 99 · '), 'rule 99 must be held');
  for (const id of [105, 106]) assert.ok(text.includes(`- [?] ${id} · `), `deferred rule ${id} is proposed again`);
  assert.match(text, /^Held by prior decision: 1 rules/m);
});

test('--record-skips on a proposal with nothing unchecked writes nothing', () => {
  const ctx = proposed();
  edit(ctx, [
    ['- [?] 105 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [?] 105 ·')).replace('- [?]', '- [x]')],
    ['- [?] 106 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [?] 106 ·')).replace('- [?]', '- [x]')],
  ]);
  const res = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'nothing_to_record');
  assert.equal(res.json.counts.approve, 7);
  assert.ok(!existsSync(ctx.ledger));
});

test('recording again after the admin unchecks another row appends only that row', () => {
  const ctx = proposed();
  const uncheck = (id) => edit(ctx, [[`- [x] ${id} ·`, readText(ctx.proposal).split('\n').find((l) => l.startsWith(`- [x] ${id} ·`)).replace('- [x]', '- [ ]')]]);
  uncheck(99);
  const first = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.deepEqual(first.json.rule_ids, [99]);
  assert.deepEqual(first.json.already_recorded, []);
  // an unchanged file appends nothing
  const again = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(again.json.status, 'already_recorded');
  assert.equal(again.json.recorded, 0);
  assert.deepEqual(again.json.already_recorded, [99]);
  assert.equal(ledgerLines(ctx.ledger).length, 1);
  // the admin changes their mind about one more row and confirms again
  uncheck(102);
  const third = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(third.json.status, 'recorded');
  assert.deepEqual(third.json.rule_ids, [102]);
  assert.deepEqual(third.json.already_recorded, [99]);
  assert.equal(third.json.counts.skip, 2);
  const lines = ledgerLines(ctx.ledger);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.rule_id), [99, 102]);
});

test('a reconsidered rule can be skipped again in the same run and is held afterwards', () => {
  const ctx = proposed();
  edit(ctx, [['- [x] 99 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 99 ·')).replace('- [x]', '- [ ]')]]);
  assert.equal(run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env }).json.recorded, 1);
  // release rule 99 and re-render: it is proposed again
  const rel = run(LEDGER, ['--reconsider', '99'], { env: ctx.env });
  assert.deepEqual(rel.json.released, [99]);
  const rerender = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1', '--replace'], { env: ctx.env });
  assert.equal(rerender.status, 0, rerender.stderr);
  assert.equal(rerender.json.held_by_prior_decision, 0);
  assert.ok(readText(ctx.proposal).includes(' 99 · '));
  // the admin unchecks it again; the new skip is appended even though this run already had one
  edit(ctx, [['- [x] 99 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 99 ·')).replace('- [x]', '- [ ]')]]);
  const again = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(again.json.status, 'recorded');
  assert.deepEqual(again.json.rule_ids, [99]);
  const lines = ledgerLines(ctx.ledger);
  assert.deepEqual(lines.map((l) => [l.rule_id, l.decision]), [[99, 'skip'], [99, 'released'], [99, 'skip']]);
  const final = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1', '--replace'], { env: ctx.env });
  assert.equal(final.json.held_by_prior_decision, 1);
  assert.ok(!readText(ctx.proposal).includes(' 99 · '));
});

test('a row this run did not propose is invalid, whether unchanged, held, or invented', () => {
  const ctx = makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS });
  // rule 101 is held by an earlier run's skip, so it is never rendered
  writeFileSync(ctx.ledger, `${JSON.stringify({
    rule_id: 101, decision: 'skip', severity_at_decision: 'error',
    content_hash: contentHash(CALIB_RULES.find((r) => r.ruleId === 101).content),
    run_id: '20251201-000000', decided_at: '2025-12-01T00:00:00.000Z',
  })}\n`);
  const r = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1'], { env: ctx.env });
  assert.equal(r.json.held_by_prior_decision, 1);
  ctx.proposal = join(ctx.runDir, 'proposal.md');
  // add rows for the held rule, an unchanged rule, and an id that does not exist
  writeFileSync(ctx.proposal, `${readText(ctx.proposal).trimEnd()}\n- [x] 101 · Held · S · error → recommendation · https://x/101\n- [x] 107 · Unchanged · S · error → warning · https://x/107\n- [x] 4242 · Invented · S · error → warning · https://x/4242\n`);
  const rb = readback(ctx);
  assert.equal(rb.counts.invalid, 3);
  assert.deepEqual(rb.invalid.map((i) => i.reason), [
    'rule 101 was not proposed in this run',
    'rule 107 was not proposed in this run',
    'rule 4242 was not proposed in this run',
  ]);
  assert.equal(rb.counts.removed, 0);
  assert.ok(!rb.rows.some((row) => [101, 107, 4242].includes(row.rule_id)));
});

test('a rule at an unknown severity renders, reads back, and can be approved', () => {
  const rules = [
    { ruleId: 501, name: 'Recorded at an odd severity', category: 'Quality', severity: 'critical', content: 'Type annotations on every public signature.', guard_hits: [] },
    { ruleId: 502, name: 'Plain decrease', category: 'Maintainability', severity: 'error', content: 'Docstrings on public functions.', guard_hits: [] },
  ];
  const ctx = makeCalibrated({ rules, tags: { 501: 'api-contract', 502: 'documentation' } });
  const r = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1'], { env: ctx.env });
  assert.equal(r.status, 0, r.stderr);
  ctx.proposal = join(ctx.runDir, 'proposal.md');
  const text = readText(ctx.proposal);
  assert.match(text, /^- \[\?\] 501 · .* · critical → warning · https:\/\/app\.qodo\.ai\/rules\/501$/m);
  const before = readback(ctx);
  assert.deepEqual(before.counts, { approve: 1, skip: 0, defer: 1, override: 0, invalid: 0, removed: 0 });
  // checking it approves the rubric's severity for its tag
  edit(ctx, [['- [?] 501 ·', text.split('\n').find((l) => l.startsWith('- [?] 501 ·')).replace('- [?]', '- [x]')]]);
  const rb = readback(ctx);
  assert.deepEqual(rb.counts, { approve: 2, skip: 0, defer: 0, override: 0, invalid: 0, removed: 0 });
  const row = rb.rows.find((x) => x.rule_id === 501);
  assert.equal(row.decision, 'approve');
  assert.equal(row.current, 'critical');
  assert.equal(row.target, 'warning');
  // editing the current field is reported instead of being decided on
  edit(ctx, [['- [x] 501 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 501 ·')).replace('critical →', 'error →')]]);
  const edited = readback(ctx);
  assert.equal(edited.counts.invalid, 1);
  assert.equal(edited.invalid[0].reason, 'current severity was edited');
  assert.equal(edited.counts.approve, 1);
});

test('a proposal with no frontmatter, or an unterminated one, says so', () => {
  const ctx = proposed();
  const rows = readText(ctx.proposal).split('\n').filter((l) => l.startsWith('- ['));
  writeFileSync(ctx.proposal, `# hand-written\n\n${rows.join('\n')}\n`);
  const none = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /has no frontmatter/);
  const ctx2 = proposed();
  const [, ...rest] = readText(ctx2.proposal).split('\n---\n');
  writeFileSync(ctx2.proposal, `---\nrun_id: ${ctx2.runId}\nrubric: |\n  version: 1\n${rest.join('\n')}`);
  const open = run(APPROVE, ['--run', ctx2.runDir, '--readback'], { env: ctx2.env });
  assert.equal(open.status, 2);
  assert.match(open.stderr, /frontmatter is not terminated/);
});

test('a pre-checked row the admin defers reads back as defer and is never recorded', () => {
  const ctx = proposed();
  edit(ctx, [['- [x] 103 ·', readText(ctx.proposal).split('\n').find((l) => l.startsWith('- [x] 103 ·')).replace('- [x]', '- [?]')]]);
  const rb = readback(ctx);
  assert.equal(rb.counts.approve, 4);
  assert.equal(rb.counts.defer, 3); // 103 joins the two needs-a-decision rows
  assert.equal(rb.counts.skip, 0);
  assert.equal(rb.rows.find((r) => r.rule_id === 103).decision, 'defer');
  const rec = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(rec.status, 0, rec.stderr);
  assert.equal(rec.json.status, 'nothing_to_record');
  assert.deepEqual(rec.json.rule_ids, []);
  assert.ok(!existsSync(ctx.ledger));
});
