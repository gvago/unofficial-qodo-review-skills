#!/usr/bin/env node
// record-batch.mjs — turn the agent's tag decisions for one batch into classification rows.
//
// Usage:
//   node record-batch.mjs --run <run-dir> --status
//   node record-batch.mjs --run <run-dir> --batch N (--tags '<json>' | --tags-file <path>) [--replace]
//
// --tags is a JSON object {"<ruleId>": "<tag>"} covering every rule in batches/batch-NNN.json.
// The script derives the proposed severity from
// <run-dir>/rubric-snapshot.yaml, applies the two vetoes on decreases (keyword guard hit;
// recommendation-default tag on a Security/Compliance rule), and APPENDS one line per rule to
// <run-dir>/classification.jsonl in a single write. Readers take the last line per rule, so
// several recorders (parallel classifier agents on different batches) can append without
// coordination and --replace is simply another append. Each row keeps the rubric's own severity
// for the tag in `rubric_proposed` — the value a veto took away. A batch already present is
// skipped unless --replace is given, which is what makes a re-run resumable. Read-only against
// the workspace.
//
// Exit codes: 0 ok (recorded or skipped), 1 usage / Node too old, 2 invalid input.

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareRuleIds, isTag, parseSnapshot, PRIOR_CATEGORIES, RANK, requireNode20, TAG_DEFAULTS, TAGS, validateSnapshot } from './lib/calibrate-lib.mjs';
import { classificationPaths, readClassification, RunError } from './lib/proposal-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`record-batch: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { run: null, batch: null, tags: null, tagsFile: null, status: false, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--batch') args.batch = Number(next());
    else if (a === '--tags') args.tags = next();
    else if (a === '--tags-file') args.tagsFile = next();
    else if (a === '--status') args.status = true;
    else if (a === '--replace') args.replace = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write("usage: node record-batch.mjs --run <run-dir> (--status | --batch N (--tags '<json>' | --tags-file <path>) [--replace])\n");
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  if (!args.run) fail(1, '--run <run-dir> is required');
  if (!args.status) {
    if (!Number.isInteger(args.batch) || args.batch < 1) fail(1, '--batch N (N >= 1) is required');
    if (!args.tags && !args.tagsFile) fail(1, "--tags '<json>' or --tags-file <path> is required");
  }
  return args;
}

function readJson(path, what) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(2, `${what} ${path} is not valid JSON (${e.message})`);
  }
  return parsed;
}

function listBatches(runDir) {
  const dir = join(runDir, 'batches');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^batch-(\d{3})\.json$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function loadRows(runDir) {
  try {
    return readClassification(runDir, (w) => process.stderr.write(`record-batch: ${w}\n`)) ?? [];
  } catch (e) {
    if (e instanceof RunError) fail(e.code, `${e.message}; fix or remove it before continuing`);
    throw e;
  }
}

function readBatch(runDir, n) {
  const path = join(runDir, 'batches', `batch-${String(n).padStart(3, '0')}.json`);
  const batch = readJson(path, 'batch file');
  const rules = Array.isArray(batch) ? batch : batch && batch.rules;
  if (!Array.isArray(rules) || !rules.length) fail(2, `batch file ${path} has no rules array`);
  for (const r of rules) {
    if (!r || typeof r !== 'object' || r.ruleId === undefined || r.ruleId === null) fail(2, `batch file ${path} has a rule without a ruleId`);
  }
  return rules;
}

function currentCounts(runDir) {
  const exportPath = join(runDir, 'export.json');
  if (!existsSync(exportPath)) return { total_rules: null, current_counts: null };
  let data;
  try { data = JSON.parse(readFileSync(exportPath, 'utf8')); } catch { return { total_rules: null, current_counts: null }; }
  const counts = { error: 0, warning: 0, recommendation: 0, other: 0 };
  const rules = Array.isArray(data.rules) ? data.rules : [];
  for (const r of rules) {
    const s = String(r.severity ?? '').toLowerCase();
    if (Object.hasOwn(RANK, s)) counts[s]++;
    else counts.other++;
  }
  return { total_rules: rules.length, current_counts: counts };
}

// Disjoint counts: decrease + increase + unchanged + needs_decision = rows.
function summarize(rows, allBatches) {
  const done = [...new Set(rows.map((r) => r.batch))].sort((a, b) => a - b);
  const count = (pred) => rows.filter(pred).length;
  return {
    batches_total: allBatches.length,
    batches_done: done,
    batches_remaining: allBatches.filter((b) => !done.includes(b)),
    rows: rows.length,
    decrease: count((r) => r.direction === 'decrease'),
    increase: count((r) => r.direction === 'increase'),
    unchanged: count((r) => r.direction === 'none' && !r.needs_decision),
    needs_decision: count((r) => r.needs_decision),
  };
}

function classify(rule, tag, severities, batch, recordedAt) {
  const current = String(rule.severity ?? '').toLowerCase();
  const guardHits = Array.isArray(rule.guard_hits) ? rule.guard_hits : [];
  const row = {
    rule_id: rule.ruleId,
    name: rule.name,
    category: rule.category,
    current,
    tag,
    rubric_proposed: severities[tag],
    proposed: current,
    direction: 'none',
    guard_hits: guardHits,
    needs_decision: false,
    batch,
    recorded_at: recordedAt,
  };
  if (!Object.hasOwn(RANK, current)) {
    // Unknown current severity: never propose, let the admin decide.
    row.needs_decision = true;
    return row;
  }
  let proposed = severities[tag];
  const wouldDecrease = RANK[proposed] < RANK[current];
  const categoryPrior = TAG_DEFAULTS[tag] === 'recommendation' && PRIOR_CATEGORIES.includes(String(rule.category ?? '').toLowerCase());
  if (wouldDecrease && (guardHits.length > 0 || categoryPrior)) {
    row.needs_decision = true;
    proposed = current;
  }
  row.proposed = proposed;
  row.direction = RANK[proposed] < RANK[current] ? 'decrease' : RANK[proposed] > RANK[current] ? 'increase' : 'none';
  return row;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const { jsonl } = classificationPaths(runDir);
  const allBatches = listBatches(runDir);
  const rows = loadRows(runDir);

  if (args.status) {
    process.stdout.write(`${JSON.stringify({ run_dir: runDir, status: 'ok', classification: jsonl, ...currentCounts(runDir), ...summarize(rows, allBatches) })}\n`);
    return;
  }

  if (!allBatches.includes(args.batch)) fail(2, `batch ${args.batch} does not exist in ${join(runDir, 'batches')} (have ${allBatches.length} batches)`);
  const existing = rows.filter((r) => r.batch === args.batch).length;
  if (existing && !args.replace) {
    process.stdout.write(`${JSON.stringify({ run_dir: runDir, status: 'already_recorded', batch: args.batch, ...currentCounts(runDir), ...summarize(rows, allBatches) })}\n`);
    return;
  }

  const snapshotPath = join(runDir, 'rubric-snapshot.yaml');
  if (!existsSync(snapshotPath)) fail(2, `${snapshotPath} missing — run rubric.mjs --snapshot first`);
  const effective = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const problems = validateSnapshot(effective);
  if (problems.length) fail(2, `${snapshotPath} is not a valid rubric snapshot: ${problems.join('; ')}`);

  const batchRules = readBatch(runDir, args.batch);

  let tags;
  try {
    tags = JSON.parse(args.tagsFile ? readFileSync(resolve(args.tagsFile), 'utf8') : args.tags);
  } catch (e) {
    fail(2, `tags are not valid JSON: ${e.message}`);
  }
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) fail(2, 'tags must be a JSON object {"<ruleId>": "<tag>"}');

  const issues = [];
  const batchIds = new Set(batchRules.map((r) => String(r.ruleId)));
  for (const id of Object.keys(tags)) {
    if (!batchIds.has(id)) issues.push(`ruleId ${id} is not in batch ${args.batch}`);
    else if (!isTag(tags[id])) issues.push(`ruleId ${id}: unknown tag "${JSON.stringify(tags[id]).replace(/^"|"$/g, '')}" (valid: ${TAGS.join(', ')})`);
  }
  for (const r of batchRules) {
    if (!Object.hasOwn(tags, String(r.ruleId))) issues.push(`ruleId ${r.ruleId} ("${r.name}") has no tag`);
  }
  if (issues.length) fail(2, `batch ${args.batch} not recorded:\n  - ${issues.join('\n  - ')}`);

  const recordedAt = new Date().toISOString();
  const newRows = [...batchRules]
    .sort((a, b) => compareRuleIds(a.ruleId, b.ruleId))
    .map((r) => classify(r, tags[String(r.ruleId)], effective.severities, args.batch, recordedAt));
  // One write for the whole batch: concurrent recorders never interleave inside a line.
  appendFileSync(jsonl, `${newRows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const merged = loadRows(runDir);
  const batchSummary = summarize(newRows, [args.batch]);
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    status: existing ? 'replaced' : 'recorded',
    batch: args.batch,
    replaced_rows: existing,
    batch_rows: batchSummary.rows,
    batch_decrease: batchSummary.decrease,
    batch_increase: batchSummary.increase,
    batch_unchanged: batchSummary.unchanged,
    batch_needs_decision: batchSummary.needs_decision,
    ...currentCounts(runDir),
    ...summarize(merged, allBatches),
  })}\n`);
}

main();
