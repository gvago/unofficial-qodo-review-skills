import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGuardMatchers, compareRuleIds, DEFAULT_GUARD_TERMS, guardHits, parseRubric, TAG_DEFAULTS, TAGS } from '../lib/calibrate-lib.mjs';
import { SKILL_VERSION, splitStatus } from '../lib/receipt-lib.mjs';
import { SKILL_DIR } from './helpers.mjs';

const hits = (text, terms = DEFAULT_GUARD_TERMS) => guardHits({ name: '', content: text }, buildGuardMatchers(terms));

test('guard stem matching', () => {
  assert.deepEqual(hits('Requires Authentication'), ['auth', 'authentic']);
  assert.deepEqual(hits('never leave deleted rows'), ['delete']);
  assert.deepEqual(hits('handles personal  data carefully'), ['personal data']);
  assert.deepEqual(hits('use the oauth flow'), []);
  assert.deepEqual(hits('written by the author'), []);
  assert.deepEqual(hits('Authored by'), []);
  assert.deepEqual(hits('AUTHORIZATION header'), ['auth', 'authoriz']);
  assert.deepEqual(hits('drop the dropdown'), ['drop']);
  assert.deepEqual(hits('a (secret) value'), ['secret']);
  assert.deepEqual(hits('name only', ['name only']), ['name only']);
  assert.deepEqual(guardHits({ name: 'Rotate Passwords', content: '' }, buildGuardMatchers(DEFAULT_GUARD_TERMS)), ['password']);
});

test('ruleId ordering is numeric-aware', () => {
  assert.deepEqual([10, 9, 100, 1].sort(compareRuleIds), [1, 9, 10, 100]);
  assert.deepEqual(['r10', 'r9', 'r100'].sort(compareRuleIds), ['r9', 'r10', 'r100']);
});

test('taxonomy includes architecture at warning and has 13 tags', () => {
  assert.equal(TAGS.length, 13);
  assert.equal(TAG_DEFAULTS.architecture, 'warning');
  assert.ok(TAGS.indexOf('architecture') > TAGS.indexOf('api-contract'));
});

test('references/rubric.md and rubric-defaults.yaml agree with the code taxonomy', () => {
  const md = readFileSync(join(SKILL_DIR, 'references', 'rubric.md'), 'utf8');
  const yaml = readFileSync(join(SKILL_DIR, 'references', 'rubric-defaults.yaml'), 'utf8');
  for (const [tag, sev] of Object.entries(TAG_DEFAULTS)) {
    assert.match(md, new RegExp(`^\\| \`${tag}\` \\| ${sev} \\|`, 'm'), `rubric.md row for ${tag}`);
    assert.match(yaml, new RegExp(`^#   ${tag.replace(/-/g, '\\-')}\\s+${sev}\\s`, 'm'), `rubric-defaults.yaml line for ${tag}`);
  }
  for (const term of DEFAULT_GUARD_TERMS) assert.ok(md.includes(`\`${term}\``), `rubric.md guard term ${term}`);
  const parsed = parseRubric(yaml, 'rubric-defaults.yaml');
  assert.deepEqual(parsed, { version: 1, severity_overrides: {}, guard_terms_extra: [] });
});

test('SKILL_VERSION matches SKILL.md metadata and the Quick start provenance flag', () => {
  // The version is stamped into every generated apply.sh header, so a drift between the code and
  // the documented version would put a wrong number in the audit trail.
  const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const metadata = skill.match(/^\s+version:\s*"([^"]+)"\s*$/m);
  assert.ok(metadata, 'SKILL.md metadata.version');
  assert.equal(metadata[1], SKILL_VERSION);
  const provenance = skill.match(/--skill-version\s+(\S+)/);
  assert.ok(provenance, 'SKILL.md Quick start --skill-version');
  assert.equal(provenance[1], SKILL_VERSION);
  // The README no longer carries a `Version x.y.z` line (dropped in e10bf37), so the only README
  // contract left is "no stale semver": every version-looking number in either doc is this one.
  const readme = readFileSync(join(SKILL_DIR, '..', '..', 'README.md'), 'utf8');
  for (const [name, text] of [['README.md', readme], ['SKILL.md', skill]]) {
    for (const found of [...text.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((m) => m[0])) {
      if (found === '0.1.0') continue; // the documented CLI minimum, not this skill's version
      assert.equal(found, SKILL_VERSION, `${name} mentions ${found}`);
    }
  }
});

test('receipt-format.md documents the status tokens the code can write', () => {
  const doc = readFileSync(join(SKILL_DIR, 'references', 'receipt-format.md'), 'utf8');
  for (const token of ['applied', 'failed(<code>)', 'deferred', 'skipped', 'verified', 'mismatch(<actual>)', 'reverted']) {
    assert.ok(doc.includes(`\`· ${token}\``) || doc.includes(`· ${token}`), `receipt-format.md token ${token}`);
  }
  // Every token the grammar strips must be named, so the page and STATUS_RE cannot drift.
  for (const token of ['applied', 'deferred', 'skipped', 'verified', 'reverted', 'mismatch(warning)', 'failed(revert:MT-VALIDATION)']) {
    assert.ok(splitStatus(`- [x] 1 · n · s · warning → error · https://x/1 · ${token}`).statuses.length === 1, `STATUS_RE knows ${token}`);
  }
  for (const token of ['applied', 'deferred', 'skipped', 'verified', 'reverted']) {
    assert.ok(doc.includes(token), `receipt-format.md mentions ${token}`);
  }
});
