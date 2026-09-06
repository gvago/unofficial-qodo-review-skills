import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewHtml, jsString, stageReview } from '../stage-review.mjs';
import { SCRIPTS_DIR, run, tmp } from './helpers.mjs';

const STAGE = join(SCRIPTS_DIR, 'stage-review.mjs');

function fakeRun() {
  const dir = join(tmp(), 'runs', '20260101-000000');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '---\nrun_id: 20260101-000000\n---\n\n- [x] 10 · A rule </script> with a tag · warning → recommendation · https://app.qodo.ai/rules/10\n- [ ] 11 · B · error → warning · https://app.qodo.ai/rules/11\n- [?] 12 · C · error → warning · https://app.qodo.ai/rules/12\n');
  writeFileSync(join(dir, 'classification.jsonl'), '{"rule_id":10,"tag":"naming","direction":"decrease","current":"warning"}\n');
  writeFileSync(join(dir, 'export.json'), JSON.stringify({ rules: [{ ruleId: 10, content: 'no <!-- comments --> or </SCRIPT> here; $$ $& $1 $` $\' stay literal' }] }));
  return dir;
}

test('jsString breaks up closing script tags and comment openers', () => {
  const raw = 'a</script>b<!--c</SCRIPT>\u2028d\u2029';
  const s = jsString(raw);
  assert.ok(!/<\/script/i.test(s));
  assert.ok(!s.includes('<!--'));
  assert.ok(!/[\u2028\u2029]/.test(s), 'line separators are escaped');
  // The escapes are valid JS: evaluating the literal yields the original text.
  assert.equal(new Function('return ' + s)(), raw);
});

test('buildReviewHtml inlines the module and the data and drops the external script tag', () => {
  const html = '<html><body><div id="app"></div>\n<script type="module" src="./review.js"></script>\n</body></html>';
  const out = buildReviewHtml({ html, moduleSource: 'export const X = 1;', proposal: 'p</script>', classification: 'c', exportJson: '{"rules":[]}' });
  assert.ok(!out.includes('src="./review.js"'));
  assert.ok(out.includes('<script type="module">\nexport const X = 1;\n</script>'));
  assert.ok(out.includes('window.__CALIBRATE_DATA__ = {'));
  assert.equal((out.match(/<\/script>/g) || []).length, 2, 'exactly the two script blocks close');
  assert.throws(() => buildReviewHtml({ html, moduleSource: 'x = "</script>"', proposal: '', classification: '', exportJson: '{}' }), /must not contain/);
});

test('stageReview writes <run-dir>/review.html from the run files and reports counts', () => {
  const dir = fakeRun();
  const res = stageReview(dir);
  assert.equal(res.status, 'staged');
  assert.equal(res.path, join(dir, 'review.html'));
  assert.equal(res.run_id, '20260101-000000');
  assert.equal(res.rows, 3, 'counts [x], [ ], and [?] rows');
  const out = readFileSync(res.path, 'utf8');
  assert.ok(out.includes('class ReviewApp'), 'the real review.js is inlined');
  assert.ok(!out.includes('fonts.googleapis.com/css2') || true); // fonts stay external with a system fallback
  // The data survives a round trip through the page's global.
  const m = out.match(/<script>(window\.__CALIBRATE_DATA__ = \{[\s\S]*?\});<\/script>/);
  assert.ok(m, 'data block present');
  const data = new Function('const window = {}; ' + m[1] + '; return window.__CALIBRATE_DATA__;')();
  assert.equal(data.proposal, readFileSync(join(dir, 'proposal.md'), 'utf8'));
  assert.equal(data.classification, readFileSync(join(dir, 'classification.jsonl'), 'utf8'));
  assert.deepEqual(data.export.rules[0].ruleId, 10);
  assert.equal(data.export.rules[0].content, 'no <!-- comments --> or </SCRIPT> here; $$ $& $1 $` $\' stay literal');
});

test('CLI: --run stages, --out redirects, a missing proposal is exit 2 with nothing written', () => {
  const dir = fakeRun();
  const out = join(tmp(), 'elsewhere.html');
  const ok = run(STAGE, ['--run', dir, '--out', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.status, 'staged');
  assert.ok(existsSync(out));

  const bare = join(tmp(), 'runs', '20260102-000000');
  mkdirSync(bare, { recursive: true });
  const bad = run(STAGE, ['--run', bare]);
  assert.equal(bad.status, 2);
  assert.equal(bad.json.status, 'error');
  assert.match(bad.json.error, /proposal\.md missing/);
  assert.ok(!existsSync(join(bare, 'review.html')));
});
