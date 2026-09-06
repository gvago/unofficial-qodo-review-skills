import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GUARD_TERMS, parseSnapshot, TAG_DEFAULTS } from '../lib/calibrate-lib.mjs';
import { RUBRIC, SKILL_DIR, run, tmp } from './helpers.mjs';

function rubricAt(content) {
  const dir = tmp();
  const path = join(dir, 'rubric.yaml');
  if (content !== null) writeFileSync(path, content);
  return { dir, path };
}

test('first run creates rubric.yaml from the shipped defaults, which parse to the taxonomy defaults', () => {
  const { path } = rubricAt(null);
  const res = run(RUBRIC, ['--rubric', path]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.created, true);
  assert.ok(existsSync(path));
  assert.deepEqual(res.json.severities, TAG_DEFAULTS);
  assert.deepEqual(res.json.guard_terms, [...DEFAULT_GUARD_TERMS]);
  assert.deepEqual(res.json.overrides, {});
  assert.equal(res.json.severities.architecture, 'warning');
  const again = run(RUBRIC, ['--rubric', path]);
  assert.equal(again.json.created, false);
});

test('default path honours QODO_HOME', () => {
  const home = tmp('home-');
  const res = run(RUBRIC, [], { env: { QODO_HOME: home } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.rubric_path, join(home, 'calibrate', 'rubric.yaml'));
  assert.ok(existsSync(res.json.rubric_path));
});

test('override + extra guard terms merge and the snapshot round-trips verbatim', () => {
  const { dir, path } = rubricAt('version: 1\nseverity_overrides:\n  documentation: warning\nguard_terms_extra:\n  - billing\n  - "personal, data"  # comment\n');
  const snap = join(dir, 'run', 'rubric-snapshot.yaml');
  const res = run(RUBRIC, ['--rubric', path, '--snapshot', snap]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.severities.documentation, 'warning');
  assert.equal(res.json.severities.naming, 'recommendation');
  assert.deepEqual(res.json.guard_terms.slice(-2), ['billing', 'personal, data']);
  const back = parseSnapshot(readFileSync(snap, 'utf8'));
  assert.deepEqual(back.severities, res.json.severities);
  assert.deepEqual(back.guard_terms, res.json.guard_terms);
  assert.match(readFileSync(snap, 'utf8'), /^  - "personal data"$/m);
});

test('spec example {docs: high} stops with the line quoted and valid tags named', () => {
  const { path } = rubricAt('version: 1\nseverity_overrides: {docs: high}\nguard_terms_extra: []\n');
  const res = run(RUBRIC, ['--rubric', path]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /rubric\.yaml:2: unknown tag "docs"/);
  assert.match(res.stderr, /> severity_overrides: \{docs: high\}/);
  assert.match(res.stderr, /valid tags: documentation, naming/);
});

test('invalid severity, unknown key, bad version each stop with exit 2', () => {
  for (const [yaml, re] of [
    ['version: 1\nseverity_overrides:\n  documentation: high\n', /:3: invalid severity "high" for tag "documentation"[\s\S]*valid severities: error, warning, recommendation/],
    ['version: 1\nseverity_overrides: {}\nfoo: bar\n', /:3: unknown key "foo"[\s\S]*top-level keys: version, severity_overrides, guard_terms_extra/],
    ['version: 2\n', /unsupported version "2"/],
    ['severity_overrides: {}\n', /missing "version: 1"/],
  ]) {
    const { path } = rubricAt(yaml);
    const res = run(RUBRIC, ['--rubric', path]);
    assert.equal(res.status, 2, yaml);
    assert.match(res.stderr, re);
  }
});

test('a UTF-8 BOM is tolerated', () => {
  const { path } = rubricAt('﻿version: 1\nseverity_overrides: {}\nguard_terms_extra: []\n');
  const res = run(RUBRIC, ['--rubric', path]);
  assert.equal(res.status, 0, res.stderr);
});

test('a tag listed twice in severity_overrides is rejected', () => {
  const { path } = rubricAt('version: 1\nseverity_overrides:\n  naming: warning\n  naming: error\n');
  const res = run(RUBRIC, ['--rubric', path]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /:4: tag "naming" appears twice/);
});

test('a quoted flow-list item containing a comma is rejected with a block-list hint', () => {
  const { path } = rubricAt('version: 1\nguard_terms_extra: ["a, b", c]\n');
  const res = run(RUBRIC, ['--rubric', path]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /quoted item containing a comma[\s\S]*use a block list/);
});

test('--snapshot refuses to overwrite an existing snapshot unless --replace-snapshot', () => {
  const { dir, path } = rubricAt('version: 1\n');
  const snap = join(dir, 'run', 'rubric-snapshot.yaml');
  assert.equal(run(RUBRIC, ['--rubric', path, '--snapshot', snap]).status, 0);
  const before = readFileSync(snap, 'utf8');
  const refused = run(RUBRIC, ['--rubric', path, '--snapshot', snap]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already exists[\s\S]*skip the rubric step[\s\S]*--replace-snapshot/);
  assert.equal(readFileSync(snap, 'utf8'), before);
  writeFileSync(path, 'version: 1\nseverity_overrides: {naming: error}\n');
  const replaced = run(RUBRIC, ['--rubric', path, '--snapshot', snap, '--replace-snapshot']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.match(readFileSync(snap, 'utf8'), /^  naming: error$/m);
});

test('runs correctly when the skill directory is a symlink (skills.sh layout)', () => {
  const dir = tmp('link-');
  const link = join(dir, 'skills', 'qodo-calibrate-rules');
  mkdirSync(join(dir, 'skills'));
  symlinkSync(SKILL_DIR, link, 'dir');
  const path = join(dir, 'rubric.yaml');
  const res = run(join(link, 'scripts', 'rubric.mjs'), ['--rubric', path]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.created, true);
  assert.ok(existsSync(path));
  assert.deepEqual(res.json.severities, TAG_DEFAULTS);
});
