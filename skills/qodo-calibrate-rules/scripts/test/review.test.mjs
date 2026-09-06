// The browser review page's pure half must agree with the skill's own grammar: what it writes is
// what approve.mjs --readback parses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_RE as LIB_ROW_RE } from '../lib/proposal-lib.mjs';
import {
  ROW_RE, buildProposal, effective, groupKey, groupOrder, overrideCycle, parseClassification,
  parseProposal, segments, tally,
} from '../../review/review.js';

const PROPOSAL = `---
run_id: 20260101-000000
workspace_id: ws
rule_count: 5
proposed: 3
held_by_prior_decision: 0
rubric: |
  version: 1
---

## Decrease → recommendation · naming (2) — pre-checked; uncheck to skip, [?] to defer

- [x] 10 · Use camelCase · warning → recommendation · https://app.qodo.ai/rules/10
- [x] 11 · Name things · with · dots · warning → recommendation · guard: token, auth · https://app.qodo.ai/rules/11

## Increase → error · security-control (1) — pre-checked; uncheck to skip, [?] to defer

- [x] 12 · Parameterize SQL · warning → error · https://app.qodo.ai/rules/12

## Needs a decision — guard or category conflict (1) — deferred; check to approve, clear to skip

- [?] 13 · Rotate secrets · error → warning · guard: secret · https://app.qodo.ai/rules/13

---
Held by prior decision: 0 rules (say "reconsider rule <id>" to release one)
`;

const CLS = [
  { rule_id: 10, tag: 'naming', direction: 'decrease', current: 'warning', needs_decision: false, category: 'Style' },
  { rule_id: 11, tag: 'naming', direction: 'decrease', current: 'warning', needs_decision: false, category: 'Style' },
  { rule_id: 12, tag: 'security-control', direction: 'increase', current: 'warning', needs_decision: false, category: 'Security' },
  { rule_id: 13, tag: 'secrets-handling', direction: 'decrease', current: 'error', needs_decision: true, category: 'Security' },
  { rule_id: 14, tag: 'logging', direction: 'none', current: 'warning', needs_decision: false, category: 'Other' },
].map((o) => JSON.stringify(o)).join('\n') + '\n';

test('the page uses the skill\'s row regex verbatim', () => {
  assert.equal(ROW_RE.source, LIB_ROW_RE.source);
  assert.equal(ROW_RE.flags, LIB_ROW_RE.flags);
});

test('parseProposal reads run id, rows, names with separators, guards, and checkboxes', () => {
  const { runId, rows } = parseProposal(PROPOSAL);
  assert.equal(runId, '20260101-000000');
  assert.deepEqual(rows.map((r) => r.id), [10, 11, 12, 13]);
  assert.equal(rows[1].name, 'Name things');
  assert.equal(rows[1].summary, 'with · dots');
  assert.deepEqual(rows[1].guard, ['token', 'auth']);
  assert.equal(rows[3].prechecked, false);
  assert.equal(rows[3].deferred, true);
  assert.equal(rows[0].deferred, false);
  assert.equal(rows[3].current, 'error');
  assert.equal(rows[3].target, 'warning');
  assert.equal(rows[0].url, 'https://app.qodo.ai/rules/10');
});

test('grouping: deferred or needs_decision → needs; else direction:tag in taxonomy order', () => {
  const { rows } = parseProposal(PROPOSAL);
  const cls = parseClassification(CLS);
  const keys = rows.map((r) => groupKey(r, cls[r.id]));
  assert.deepEqual(keys, ['dec:naming', 'dec:naming', 'inc:security-control', 'needs']);
  assert.deepEqual(groupOrder([...new Set(keys)]), ['needs', 'inc:security-control', 'dec:naming']);
  // No classification line at all: fall back to the rank of current vs target.
  assert.equal(groupKey(rows[2], undefined), 'inc:other');
});

test('buildProposal rewrites only checkbox and target; undecided rows export as deferred', () => {
  const { rows } = parseProposal(PROPOSAL);
  const decisions = {
    10: { d: 'approve', target: null, reviewed: true },
    11: { d: 'override', target: 'error', reviewed: true },
    13: { d: 'approve', target: null, reviewed: true },
    // 12 undecided → deferred
  };
  const out = buildProposal(PROPOSAL, rows, decisions);
  const outLines = out.split('\n'), inLines = PROPOSAL.split('\n');
  assert.equal(outLines.length, inLines.length);
  const rowLines = new Set(rows.map((r) => r.line));
  inLines.forEach((l, i) => { if (!rowLines.has(i)) assert.equal(outLines[i], l, `line ${i} changed`); });

  const parsed = outLines.map((l) => LIB_ROW_RE.exec(l)).filter(Boolean).map((m) => ({ box: m[1], id: +m[2], current: m[4], target: m[5], guard: m[6], url: m[7] }));
  assert.deepEqual(parsed, [
    { box: 'x', id: 10, current: 'warning', target: 'recommendation', guard: undefined, url: 'https://app.qodo.ai/rules/10' },
    { box: 'x', id: 11, current: 'warning', target: 'error', guard: 'token, auth', url: 'https://app.qodo.ai/rules/11' },
    { box: '?', id: 12, current: 'warning', target: 'error', guard: undefined, url: 'https://app.qodo.ai/rules/12' },
    { box: 'x', id: 13, current: 'error', target: 'warning', guard: 'secret', url: 'https://app.qodo.ai/rules/13' },
  ]);
  // The name with separators survived untouched.
  assert.match(out, /- \[x\] 11 · Name things · with · dots · warning → error · guard: token, auth · /);
});

test('an explicit skip unchecks a pre-checked row and leaves its target alone', () => {
  const { rows } = parseProposal(PROPOSAL);
  const out = buildProposal(PROPOSAL, rows, { 12: { d: 'skip', target: null, reviewed: true } });
  assert.match(out, /^- \[ \] 12 · Parameterize SQL · warning → error · https/m);
});

test('tally and after-apply projection', () => {
  const { rows } = parseProposal(PROPOSAL);
  const cls = parseClassification(CLS);
  const decisions = { 10: { d: 'approve', reviewed: true }, 11: { d: 'override', target: 'error', reviewed: true }, 12: { d: 'skip', reviewed: true } };
  const t = tally(rows, decisions, cls);
  assert.deepEqual({ ...t, after: undefined }, { approve: 1, skip: 1, override: 1, reviewed: 3, deferred: 1, after: undefined });
  // Start: 4 warning, 1 error. 10 → recommendation, 11 → error.
  assert.deepEqual(t.after, { error: 2, warning: 2, recommendation: 1 });
  assert.deepEqual(effective(decisions, rows[3]), { d: 'defer', reviewed: false });
});

test('parseClassification keeps the last line per rule and skips junk', () => {
  const cls = parseClassification('{"rule_id":1,"tag":"a"}\nnot json\n\n{"rule_id":1,"tag":"b"}\n{"no_id":true}\n');
  assert.deepEqual(Object.keys(cls), ['1']);
  assert.equal(cls[1].tag, 'b');
});

test('segments marks guard terms case-insensitively and escapes regex metacharacters', () => {
  const segs = segments('Auth tokens (PII) here', ['auth', '(PII)']);
  assert.deepEqual(segs, [
    { text: 'Auth', hit: true }, { text: ' tokens ', hit: false }, { text: '(PII)', hit: true }, { text: ' here', hit: false },
  ]);
  assert.deepEqual(segments('', ['x']), [{ text: '(no rule text in export.json)', hit: false }]);
});

test('override cycles through severities that are neither current nor proposed', () => {
  const row = { current: 'warning', target: 'recommendation' };
  assert.equal(overrideCycle(row, { d: 'skip' }), 'error');
  assert.equal(overrideCycle(row, { d: 'override', target: 'error' }), 'error');
  assert.equal(overrideCycle({ current: 'error', target: 'warning' }, { d: 'approve' }), 'recommendation');
});
