#!/usr/bin/env node
// proposal.mjs — render the proposal checklist from a finished classification.
//
// Usage:
//   node proposal.mjs --run <run-dir> --render --workspace-id <id> [--replace]
//
// Writes <run-dir>/proposal.md, refusing on an incomplete classification or an existing
// proposal.md without --replace. Rules the admin already decided (decisions.jsonl) are held out
// of the proposal and counted in its footer. Read-only against the workspace.
//
// Exit codes: 0 ok, 1 usage / Node too old, 2 refused (nothing written).

import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requireNode20 } from './lib/calibrate-lib.mjs';
import { isHeld, latestByRule, ledgerPath, readLedger } from './lib/ledger-lib.mjs';
import { buildSections, isRendered, loadRun, renderProposal, ruleUrl, RunError, targetFor } from './lib/proposal-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`proposal: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { run: null, render: false, workspaceId: null, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--render') args.render = true;
    else if (a === '--workspace-id') args.workspaceId = next();
    else if (a === '--replace') args.replace = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node proposal.mjs --run <run-dir> --render --workspace-id <id> [--replace]\n');
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  if (!args.run) fail(1, '--run <run-dir> is required');
  if (!args.render) fail(1, '--render is required');
  if (!args.workspaceId) fail(1, '--render needs --workspace-id <id> (from qodo read whoami)');
  return args;
}

function load(runDir) {
  try {
    return loadRun(runDir);
  } catch (e) {
    if (e instanceof RunError) fail(e.code, e.message);
    throw e;
  }
}

// The rows that belong in the proposal: a rubric-proposed change or a needs-a-decision row,
// minus everything a prior decision holds.
function renderable(run) {
  const latest = latestByRule(readLedger(ledgerPath()));
  const candidates = run.rows.filter(isRendered);
  const held = [];
  const rows = [];
  for (const row of candidates) {
    const key = String(row.rule_id);
    if (isHeld(row, run.rules.get(key), latest.get(key))) held.push(row);
    else rows.push(row);
  }
  return { rows, held };
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const run = load(runDir);
  const { rows, held } = renderable(run);

  if (run.batchesRemaining.length) {
    fail(2, `classification is incomplete — ${run.batchesRemaining.length} batch(es) not recorded: ${run.batchesRemaining.join(', ')}. Classify them first (record-batch.mjs --status).`);
  }
  const proposalPath = join(runDir, 'proposal.md');
  if (existsSync(proposalPath) && !args.replace) {
    fail(2, `${proposalPath} already exists — pass --replace to overwrite it (ask the admin first if they have edited it).`);
  }

  const displayRows = rows.map((row) => {
    const rule = run.rules.get(String(row.rule_id));
    return {
      rule_id: row.rule_id,
      name: row.name,
      current: row.current,
      target: targetFor(row, run.snapshot),
      guard_hits: row.guard_hits,
      url: ruleUrl(rule, row.rule_id),
      tag: row.tag,
      direction: row.direction,
      needs_decision: Boolean(row.needs_decision),
      checked: !row.needs_decision,
      deferred: Boolean(row.needs_decision),
    };
  });
  const sections = buildSections(displayRows);
  const proposed = displayRows.filter((r) => r.checked).length;
  const text = renderProposal({
    run_id: run.runId,
    workspace_id: args.workspaceId,
    rule_count: run.rows.length,
    proposed,
    held_by_prior_decision: held.length,
    rubric: run.rubricText,
    sections,
  });
  const replaced = existsSync(proposalPath);
  writeAtomic(proposalPath, text);
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    status: replaced ? 'replaced' : 'rendered',
    path: proposalPath,
    run_id: run.runId,
    workspace_id: args.workspaceId,
    rule_count: run.rows.length,
    rows: displayRows.length,
    proposed,
    needs_decision: displayRows.length - proposed,
    held_by_prior_decision: held.length,
    sections: sections.length,
  })}\n`);
}

main();
