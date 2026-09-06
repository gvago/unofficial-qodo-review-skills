#!/usr/bin/env node
// rubric.mjs — create (first run), validate, and merge the calibration rubric.
//
// Usage:
//   node rubric.mjs [--rubric <path>] [--snapshot <run-dir>/rubric-snapshot.yaml] [--replace-snapshot]
//
// Default rubric path: ${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml. When the file is
// missing it is written from ../references/rubric-defaults.yaml. The file is then parsed
// (a fixed YAML subset — no library), validated against references/rubric.md, and merged
// with the defaults (lib/calibrate-lib.mjs is the source of truth for the taxonomy and the
// default guard terms). Prints one JSON object: {rubric_path, created, overrides,
// guard_terms_extra, severities, guard_terms, snapshot}. With --snapshot, also writes the
// merged effective rubric to that path — and refuses if it already exists (a resumed run keeps
// its pinned rubric) unless --replace-snapshot is given.
//
// Exit codes: 0 ok, 1 usage / Node too old, 2 invalid rubric or snapshot conflict.

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRubric, parseRubric, renderSnapshot, requireNode20, RubricError } from './lib/calibrate-lib.mjs';

requireNode20();

const HERE = realpathSync(dirname(fileURLToPath(import.meta.url)));
const DEFAULTS_PATH = join(HERE, '..', 'references', 'rubric-defaults.yaml');

function qodoHome() {
  return process.env.QODO_HOME || join(homedir(), '.qodo');
}

function fail(code, message) {
  process.stderr.write(`rubric: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { rubric: join(qodoHome(), 'calibrate', 'rubric.yaml'), snapshot: null, replaceSnapshot: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--rubric') args.rubric = next();
    else if (a === '--snapshot') args.snapshot = next();
    else if (a === '--replace-snapshot') args.replaceSnapshot = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node rubric.mjs [--rubric <path>] [--snapshot <path>] [--replace-snapshot]\n');
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const rubricPath = resolve(args.rubric);
const snapshotPath = args.snapshot ? resolve(args.snapshot) : null;

if (snapshotPath && existsSync(snapshotPath) && !args.replaceSnapshot) {
  fail(2, `${snapshotPath} already exists — this run is pinned to that rubric. To resume the run, skip the rubric step and use the existing snapshot; pass --replace-snapshot only to deliberately re-pin (already recorded batches were classified under the old snapshot).`);
}

let created = false;
if (!existsSync(rubricPath)) {
  if (!existsSync(DEFAULTS_PATH)) fail(2, `defaults template missing at ${DEFAULTS_PATH}`);
  mkdirSync(dirname(rubricPath), { recursive: true });
  copyFileSync(DEFAULTS_PATH, rubricPath);
  created = true;
}

let rubric;
try {
  rubric = parseRubric(readFileSync(rubricPath, 'utf8'), rubricPath);
} catch (e) {
  if (e instanceof RubricError) {
    process.stderr.write(e.format());
    process.exit(2);
  }
  throw e;
}
const effective = mergeRubric(rubric);

if (snapshotPath) {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, renderSnapshot(effective, rubricPath, rubric.severity_overrides));
}

process.stdout.write(`${JSON.stringify({
  rubric_path: rubricPath,
  created,
  overrides: rubric.severity_overrides,
  guard_terms_extra: rubric.guard_terms_extra,
  severities: effective.severities,
  guard_terms: effective.guard_terms,
  snapshot: snapshotPath,
})}\n`);
