import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash } from '../lib/ledger-lib.mjs';
import { parseFrontmatter, parseProposal, parseRow, renderRow } from '../lib/proposal-lib.mjs';
import {
  APPROVE, CALIB_DECISIONS, CALIB_PRECHECKED, CALIB_RULES, CALIB_TAGS, CALIB_UNCHANGED,
  PROPOSAL, classificationRows, makeCalibrated, readText, run,
} from './helpers.mjs';

const RENDERED = [...CALIB_PRECHECKED, ...CALIB_DECISIONS];

function setup(opts = {}) {
  return makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS, ...opts });
}

function render(ctx, extra = []) {
  return run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1', ...extra], { env: ctx.env });
}

function seedLedger(ctx, entries) {
  writeFileSync(ctx.ledger, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

function entry(ruleId, decision, severity, { content = null, run_id = '20251201-000000' } = {}) {
  const rule = CALIB_RULES.find((r) => r.ruleId === ruleId);
  return {
    rule_id: ruleId,
    decision,
    severity_at_decision: severity,
    content_hash: contentHash(content ?? rule.content),
    run_id,
    decided_at: '2025-12-01T00:00:00.000Z',
  };
}

test('render writes only diff and needs-a-decision rows, in section order, and every row parses back', () => {
  const ctx = setup();
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'rendered');
  assert.equal(res.json.rows, 7);
  assert.equal(res.json.proposed, 5);
  assert.equal(res.json.needs_decision, 2);
  assert.equal(res.json.held_by_prior_decision, 0);
  assert.equal(res.json.sections, 5);

  const text = readText(join(ctx.runDir, 'proposal.md'));
  const { frontmatter, rows } = parseProposal(text);
  assert.equal(frontmatter.run_id, ctx.runId);
  assert.equal(frontmatter.workspace_id, 'ws-1');
  assert.equal(frontmatter.rule_count, 9);
  assert.equal(frontmatter.proposed, 5);
  assert.equal(frontmatter.held_by_prior_decision, 0);
  assert.match(frontmatter.rubric, /^version: 1$/m);
  assert.match(frontmatter.rubric, /^severities:$/m);
  assert.match(text, /^# Qodo Standards Calibration — proposal$/m);

  // sections: decreases in taxonomy order, then increases, then needs-a-decision
  const headings = text.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## Decrease → recommendation · documentation (2) — pre-checked; uncheck to skip, [?] to defer',
    '## Decrease → recommendation · naming (1) — pre-checked; uncheck to skip, [?] to defer',
    '## Decrease → recommendation · style-formatting (1) — pre-checked; uncheck to skip, [?] to defer',
    '## Increase → error · secrets-handling (1) — pre-checked; uncheck to skip, [?] to defer',
    '## Needs a decision — guard or category conflict (2) — deferred; check to approve, clear to skip',
  ]);
  // rows by numeric id inside a section; unchanged rules never appear
  assert.deepEqual(rows.map((r) => r.rule_id), [99, 101, 102, 103, 104, 105, 106]);
  for (const id of CALIB_UNCHANGED) assert.ok(!text.includes(` ${id} · `), `rule ${id} must not appear`);
  // every row parses back to (id, decision, target)
  for (const row of rows) {
    assert.ok(row.ok, `row ${row.line} parses: ${row.raw}`);
    assert.equal(row.checked, CALIB_PRECHECKED.includes(row.rule_id));
    assert.ok(['error', 'warning', 'recommendation'].includes(row.target));
  }
  // needs-a-decision rows are proposed at the rubric severity the veto took away
  const nd = rows.filter((r) => CALIB_DECISIONS.includes(r.rule_id));
  assert.deepEqual(nd.map((r) => r.target), ['recommendation', 'recommendation']);
  assert.deepEqual(nd.map((r) => r.checked), [false, false]);
  assert.deepEqual(nd.map((r) => r.deferred), [true, true]);
  // guard terms are comma-joined; the rule's own url wins over the app.qodo.ai fallback
  assert.match(text, /- \[x\] 104 · Never log session tokens · warning → error · guard: token, secret · https:\/\/portal\.example\.com\/rules\/104$/m);
  assert.match(text, /- \[\?\] 105 · .* · guard: encrypt · https:\/\/app\.qodo\.ai\/rules\/105$/m);
  assert.match(text, /- \[\?\] 106 · .* · warning → recommendation · https:\/\/app\.qodo\.ai\/rules\/106$/m);
  // footer is always rendered
  assert.match(text, /\n---\nHeld by prior decision: 0 rules \(say "reconsider rule <id>" to release one\)\n$/);
});

test('pre-checked and deferred rows never share a section', () => {
  const ctx = setup();
  assert.equal(render(ctx).status, 0);
  const text = readText(join(ctx.runDir, 'proposal.md'));
  let heading = null;
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { heading = line; seen.set(heading, new Set()); continue; }
    const row = /^- \[( |x|\?)\]/.exec(line);
    if (row && heading) seen.get(heading).add(row[1]);
  }
  for (const [head, states] of seen) {
    assert.equal(states.size, 1, `${head} mixes checked and deferred rows`);
    assert.equal([...states][0], head.startsWith('## Needs a decision') ? '?' : 'x');
  }
});

test('render refuses an incomplete classification and names the remaining batches', () => {
  const ctx = setup({ batch2: [{ ruleId: 200, name: 'Later', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] }] });
  const res = render(ctx);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /classification is incomplete — 1 batch\(es\) not recorded: 2/);
  assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
});





test('render refuses to overwrite proposal.md without --replace', () => {
  const ctx = setup();
  assert.equal(render(ctx).status, 0);
  const again = render(ctx);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already exists — pass --replace/);
  const replaced = render(ctx, ['--replace']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(replaced.json.status, 'replaced');
});

test('a prior skip holds the row while the content is unchanged, and shows in the footer', () => {
  const ctx = setup();
  seedLedger(ctx, [entry(101, 'skip', 'error')]);
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.held_by_prior_decision, 1);
  assert.equal(res.json.rows, 6);
  const text = readText(join(ctx.runDir, 'proposal.md'));
  assert.ok(!text.includes(' 101 · '));
  assert.match(text, /^Held by prior decision: 1 rules \(say "reconsider rule <id>" to release one\)$/m);
  assert.match(text, /^## Decrease → recommendation · documentation \(1\) — pre-checked; uncheck to skip, \[\?\] to defer$/m);
});

test('a deferred row is recorded nowhere and is proposed again on the next render', () => {
  const ctx = setup();
  assert.equal(render(ctx).status, 0);
  // the admin leaves the needs-a-decision rows as `[?]` and confirms
  const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(rb.status, 0, rb.stderr);
  assert.equal(rb.json.counts.defer, CALIB_DECISIONS.length);
  const rec = run(APPROVE, ['--run', ctx.runDir, '--record-skips'], { env: ctx.env });
  assert.equal(rec.status, 0, rec.stderr);
  assert.deepEqual(rec.json.rule_ids, []);
  assert.ok(!existsSync(ctx.ledger), 'a defer writes no ledger entry');
  // so nothing holds them: a second render proposes them again, still deferred
  const again = render(ctx, ['--replace']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.held_by_prior_decision, 0);
  assert.equal(again.json.rows, RENDERED.length);
  const text = readText(join(ctx.runDir, 'proposal.md'));
  for (const id of CALIB_DECISIONS) assert.match(text, new RegExp(`^- \\[\\?\\] ${id} · `, 'm'));
});

test('edited content releases a skip; an override behaves like a skip', () => {
  const ctx = setup();
  seedLedger(ctx, [entry(101, 'skip', 'error', { content: 'the rule text as it was when the admin skipped it' })]);
  const changed = render(ctx);
  assert.equal(changed.json.held_by_prior_decision, 0);
  assert.ok(readText(join(ctx.runDir, 'proposal.md')).includes(' 101 · '));
  seedLedger(ctx, [entry(102, 'override', 'warning')]);
  const held = render(ctx, ['--replace']);
  assert.equal(held.json.held_by_prior_decision, 1);
});

test('an approve holds only while the severity has not drifted; released always re-renders', () => {
  const ctx = setup();
  // rule 101 is at error and was approved at error → held even though the rubric now wants less
  seedLedger(ctx, [entry(101, 'approve', 'error')]);
  assert.equal(render(ctx).json.held_by_prior_decision, 1);
  // approved down to recommendation but the rule sits at error again → drifted, re-render
  seedLedger(ctx, [entry(101, 'approve', 'recommendation')]);
  assert.equal(render(ctx, ['--replace']).json.held_by_prior_decision, 0);
  // a release always wins over the entry before it
  seedLedger(ctx, [entry(101, 'skip', 'error'), entry(101, 'released', 'error')]);
  assert.equal(render(ctx, ['--replace']).json.held_by_prior_decision, 0);
});

test('a corrupt ledger line is skipped with a warning instead of stopping the render', () => {
  const ctx = setup();
  writeFileSync(ctx.ledger, `${JSON.stringify(entry(101, 'skip', 'error'))}\nnot json\n{"decision":"skip"}\n\n`);
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.held_by_prior_decision, 1);
  assert.match(res.stderr, /skipping unreadable line/);
  assert.match(res.stderr, /skipping line without a rule_id/);
});

test('row grammar round-trips, including guard lists and an odd name', () => {
  const row = {
    rule_id: 815399, name: 'Use A → B only via the façade · always',
    current: 'error', target: 'recommendation', guard_hits: ['auth', 'personal data'], url: 'https://app.qodo.ai/rules/815399', checked: true,
  };
  const line = renderRow(row);
  assert.equal(line, '- [x] 815399 · Use A → B only via the façade · always · error → recommendation · guard: auth, personal data · https://app.qodo.ai/rules/815399');
  const back = parseRow(line, 12);
  assert.equal(back.ok, true);
  assert.equal(back.line, 12);
  assert.equal(back.rule_id, 815399);
  assert.equal(back.checked, true);
  assert.equal(back.current, 'error');
  assert.equal(back.target, 'recommendation');
  assert.deepEqual(back.guard_hits, ['auth', 'personal data']);
  assert.equal(back.url, 'https://app.qodo.ai/rules/815399');
  // an unchecked row and an edited target still parse; "critical" is a target, not a mangled row
  const edited = parseRow('- [ ] 42 · N · S · warning → critical · https://x/42', 3);
  assert.equal(edited.ok, true);
  assert.equal(edited.checked, false);
  assert.equal(edited.target, 'critical');
  // a deleted separator is unparseable
  assert.equal(parseRow('- [x] 42 · N · S · warning → recommendation https://x/42', 4).ok, false);
  assert.equal(parseRow('- [x] 42 · N · S · warning → recommendation https://x/42', 4).reason, 'unparseable row');
  // a rule sitting at a severity this skill does not know still parses; the reader compares the
  // current field against the classification row rather than the grammar
  const odd = parseRow('- [ ] 42 · N · S · critical → warning · https://x/42', 5);
  assert.equal(odd.ok, true);
  assert.equal(odd.rule_id, 42);
  assert.equal(odd.current, 'critical');
  assert.equal(odd.target, 'warning');
  // a newline in a name collapses so the row stays one line
  assert.equal(
    renderRow({ rule_id: 7, name: 'Two\nlines', current: 'error', target: 'warning', guard_hits: [], url: 'https://x/7', checked: true }),
    '- [x] 7 · Two lines · error → warning · https://x/7',
  );
});


test('rows recorded before rubric_proposed existed take the target from the run snapshot', () => {
  const ctx = setup();
  // a 0.2.0 classification.json (JSON array, no rubric_proposed on any row) instead of the jsonl
  const legacy = classificationRows(ctx.runDir).map(({ rubric_proposed, recorded_at, ...rest }) => rest);
  assert.ok(!Object.hasOwn(legacy[0], 'rubric_proposed'));
  writeFileSync(join(ctx.runDir, 'classification.json'), JSON.stringify(legacy, null, 1));
  rmSync(join(ctx.runDir, 'classification.jsonl'));
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  const { rows } = parseProposal(readText(join(ctx.runDir, 'proposal.md')));
  const nd = rows.filter((r) => CALIB_DECISIONS.includes(r.rule_id));
  // 105 is documentation, 106 is naming — both recommendation in the snapshot
  assert.deepEqual(nd.map((r) => [r.rule_id, r.current, r.target]), [[105, 'warning', 'recommendation'], [106, 'warning', 'recommendation']]);
  const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(rb.status, 0, rb.stderr);
  assert.deepEqual(rb.json.counts, { approve: 5, skip: 0, defer: 2, override: 0, invalid: 0, removed: 0 });
  assert.equal(rb.json.rows.find((r) => r.rule_id === 105).target, 'recommendation');
});




test('a run folder missing one of its files is refused by both scripts with a named message', () => {
  for (const file of ['classification.jsonl', 'export.json', 'rubric-snapshot.yaml']) {
    const ctx = setup();
    rmSync(join(ctx.runDir, file));
    const res = render(ctx);
    assert.equal(res.status, 2, `${file}: ${res.stdout}`);
    assert.match(res.stderr, new RegExp(`${file.replace('.', '\\.')} missing`));
    assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
    const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
    assert.equal(rb.status, 2);
    assert.match(rb.stderr, new RegExp(`${file.replace('.', '\\.')} missing`));
  }
});

test('a malformed run file is a plain refusal, not a crash', () => {
  const ctx = setup();
  writeFileSync(join(ctx.runDir, 'export.json'), JSON.stringify([{ ruleId: 1 }]));
  const asArray = render(ctx);
  assert.equal(asArray.status, 2);
  assert.match(asArray.stderr, /must be a JSON object with a rules array/);
  const ctx2 = setup();
  writeFileSync(join(ctx2.runDir, 'classification.jsonl'), `${JSON.stringify({ rule_id: 1, direction: 'none' })}\n"nope"\n`);
  const badRow = render(ctx2);
  assert.equal(badRow.status, 2);
  assert.match(badRow.stderr, /not a classification row/);
  // an unreadable line is skipped with a warning, the way the ledger does it
  const ctx4 = setup();
  appendFileSync(join(ctx4.runDir, 'classification.jsonl'), 'not json\n');
  const warned = render(ctx4);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /classification\.jsonl:\d+: skipping unreadable line/);
});

test('parseFrontmatter says what is wrong and coerces only the count keys', () => {
  const ok = parseFrontmatter('---\nrun_id: 20260101-000000\nrule_count: 9\nproposed: 5\nheld_by_prior_decision: 0\nworkspace_id: 12345\nrubric: |\n  version: 1\n---\nbody\n');
  assert.equal(ok.error, null);
  assert.equal(ok.frontmatter.run_id, '20260101-000000');
  assert.equal(ok.frontmatter.workspace_id, '12345'); // an all-digit id stays a string
  assert.equal(ok.frontmatter.rule_count, 9);
  assert.equal(ok.frontmatter.proposed, 5);
  assert.equal(ok.frontmatter.held_by_prior_decision, 0);
  assert.equal(ok.frontmatter.rubric, 'version: 1\n');
  assert.equal(parseFrontmatter('# just a heading\n- [x] 1 · a · b · error → warning · u\n').error, 'missing');
  assert.equal(parseFrontmatter('---\nrun_id: 20260101-000000\nrubric: |\n  version: 1\n').error, 'unterminated');
});


