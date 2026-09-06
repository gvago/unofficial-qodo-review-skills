#!/usr/bin/env node
// approve.mjs — read the admin's edited proposal.md back, then record their skips.
//
// Usage:
//   node approve.mjs --run <run-dir> --readback
//   node approve.mjs --run <run-dir> --record-skips
//
// --readback parses <run-dir>/proposal.md and prints one JSON object: the decision per row
// (checkbox = approve/skip, an edited target = override), every invalid row by line number with
// its reason, how many rows were deleted from the file, and the readback line to show the admin.
// It writes nothing. --record-skips appends the readback's skip rows to the decisions ledger so
// the next run does not re-propose them; a rule this run has already recorded as skipped is
// left alone, so recording again after the admin unchecks another row appends only the new one.
// Approvals and overrides are recorded by apply.mjs --write-receipt, after they are applied.

// The row grammar, the readback rules, and the hold rule live in lib/readback-lib.mjs so this
// script and apply.mjs can never disagree about what the admin decided.
//
// Exit codes: 0 ok, 1 usage / Node too old, 2 refused (no proposal, run id mismatch).

import { resolve } from 'node:path';
import { requireNode20 } from './lib/calibrate-lib.mjs';
import { RunError } from './lib/proposal-lib.mjs';
import { readback, recordSkips } from './lib/readback-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`approve: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { run: null, readback: false, recordSkips: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--readback') args.readback = true;
    else if (a === '--record-skips') args.recordSkips = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node approve.mjs --run <run-dir> (--readback | --record-skips)\n');
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  if (!args.run) fail(1, '--run <run-dir> is required');
  if (args.readback === args.recordSkips) fail(1, 'pass exactly one of --readback, --record-skips');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  let result;
  try {
    result = readback(runDir);
  } catch (e) {
    if (e instanceof RunError) fail(e.code, e.message);
    throw e;
  }

  if (args.readback) {
    process.stdout.write(`${JSON.stringify({
      run_dir: runDir,
      status: 'ok',
      run_id: result.run.runId,
      proposal: result.proposalPath,
      rendered_rows: result.expected,
      counts: result.counts,
      rows: result.rows,
      invalid: result.invalid,
      removed: result.counts.removed,
      removed_ids: result.removedIds,
      readback_text: result.readback_text,
    })}\n`);
    return;
  }

  // --record-skips: appends the admin's skips. `apply.mjs --generate` records the same rows the
  // same way, so the skips are on record even if this step is missed; the shared helper is what
  // guarantees the two agree.
  const recorded = recordSkips(result);
  process.stdout.write(`${JSON.stringify({
    ...recorded,
    run_id: result.run.runId,
    counts: result.counts,
  })}\n`);
}

main();
