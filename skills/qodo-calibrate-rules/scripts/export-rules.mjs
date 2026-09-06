#!/usr/bin/env node
// export-rules.mjs — page every active Review Standards rule into a run folder.
//
// Usage:
//   node export-rules.mjs --out <run-dir> [--qodo <launcher>] [--read-args "read rules list"]
//
// Requires <run-dir>/rubric-snapshot.yaml (written by rubric.mjs); its guard_terms drive the
// precomputed guard hits. Writes <run-dir>/export.json (raw rules + totalCount, exported_at,
// run_id), <run-dir>/batches/batch-NNN.json (40 rules each: ruleId, name, category,
// severity, content, guard_hits[]) and, beside each, batch-NNN.txt — the same rules as plain
// text, which is what a classifier reads (no JSON escaping, ~10% fewer tokens, nothing to dump). Read-only against the workspace: the only Qodo command it
// runs is the catalog's read command for rules-list. Node >= 20, built-ins only.
//
// Exit codes: 0 exported (or already exported), 1 usage / Node too old, 2 export failed.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildGuardMatchers, compareRuleIds, guardHits, parseSnapshot, requireNode20, validateSnapshot } from './lib/calibrate-lib.mjs';
import { DEFAULT_READ_ARGS, ExportError, fetchAll } from './lib/export-lib.mjs';

requireNode20();

const BATCH_SIZE = 40;

function fail(code, message) {
  process.stderr.write(`export-rules: ${message}\n`);
  process.exit(code);
}

function usage(code) {
  const text = `usage: node export-rules.mjs --out <run-dir> [--qodo <launcher>] [--read-args "${DEFAULT_READ_ARGS}"]\n`;
  (code === 0 ? process.stdout : process.stderr).write(text);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { out: null, qodo: 'qodo', readArgs: DEFAULT_READ_ARGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--out') args.out = next();
    else if (a === '--qodo') args.qodo = next();
    else if (a === '--read-args') args.readArgs = next();
    else if (a === '-h' || a === '--help') usage(0);
    else fail(1, `unknown argument: ${a}`);
  }
  if (!args.out) usage(1);
  args.readArgs = args.readArgs.trim().split(/\s+/).filter(Boolean);
  if (!args.readArgs.length) fail(1, '--read-args must name the rules-list read command, e.g. "read rules list"');
  return args;
}

// The plain-text view of a batch: a header line per rule, then its content verbatim.
export function renderBatchText(runId, batchNo, rules) {
  const out = [`# run ${runId} · batch ${batchNo} · ${rules.length} rules`, ''];
  for (const r of rules) {
    const guard = r.guard_hits && r.guard_hits.length ? r.guard_hits.join(', ') : '-';
    out.push(`=== ${r.ruleId} | ${r.name} | category=${r.category} | severity=${r.severity} | guard=${guard}`);
    out.push(String(r.content ?? '(no content)').replace(/\s+$/, ''));
    out.push('');
  }
  out.push(`IDS=${rules.map((r) => r.ruleId).join(',')}`);
  return `${out.join('\n')}\n`;
}

// The batch files proper are the .json ones; `withViews` adds their .txt siblings (for cleanup).
function batchFiles(dir, withViews = false) {
  const re = withViews ? /^batch-\d{3}\.(json|txt)$/ : /^batch-\d{3}\.json$/;
  return existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)) : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  const runId = basename(outDir);
  const exportPath = join(outDir, 'export.json');
  const batchesDir = join(outDir, 'batches');
  const snapshotPath = join(outDir, 'rubric-snapshot.yaml');

  if (existsSync(exportPath)) {
    let existing;
    try { existing = JSON.parse(readFileSync(exportPath, 'utf8')); } catch (e) { fail(2, `${exportPath} is not valid JSON (${e.message}); remove export.json to re-export.`); }
    const existingBatches = batchFiles(batchesDir).length;
    if (existing.totalCount > 0 && existingBatches === 0) fail(2, `${exportPath} is present but ${batchesDir} is missing or empty; remove export.json to re-export.`);
    process.stdout.write(`${JSON.stringify({ run_id: runId, status: 'already_exported', totalCount: existing.totalCount, exported: Array.isArray(existing.rules) ? existing.rules.length : null, export: exportPath, batches: existingBatches })}\n`);
    return;
  }

  if (!existsSync(snapshotPath)) fail(2, `${snapshotPath} missing — run rubric.mjs --snapshot ${snapshotPath} first; its guard_terms drive the export's guard hits.`);
  const effective = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const problems = validateSnapshot(effective);
  if (problems.length) fail(2, `${snapshotPath} is not a valid rubric snapshot: ${problems.join('; ')}`);
  const matchers = buildGuardMatchers(effective.guard_terms);

  let fetched;
  try {
    fetched = fetchAll(args.qodo, args.readArgs, { name: 'export-rules' });
  } catch (e) {
    if (e instanceof ExportError) fail(2, `${e.message} Nothing written.`);
    throw e;
  }
  const { rules, totalCount, pages, pageSize } = fetched;

  const ids = new Set();
  for (const r of rules) {
    const key = String(r.ruleId);
    if (ids.has(key)) fail(2, `duplicate ruleId ${r.ruleId} across pages; fetched ${rules.length}, totalCount ${totalCount}. Nothing written.`);
    ids.add(key);
  }
  if (rules.length !== totalCount) fail(2, `fetched ${rules.length} rules but totalCount is ${totalCount} (${pages} pages). Nothing written.`);

  // Batches are ordered by ruleId so the same workspace yields the same batch files.
  const ordered = [...rules].sort((a, b) => compareRuleIds(a.ruleId, b.ruleId));
  mkdirSync(batchesDir, { recursive: true });
  for (const stale of batchFiles(batchesDir, true)) unlinkSync(join(batchesDir, stale));
  const exportedAt = new Date().toISOString();
  let guardHitRules = 0;
  let batchCount = 0;
  for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
    batchCount++;
    const slice = ordered.slice(i, i + BATCH_SIZE).map((r) => {
      const hits = guardHits(r, matchers);
      if (hits.length) guardHitRules++;
      return { ruleId: r.ruleId, name: r.name, category: r.category, severity: r.severity, content: r.content, guard_hits: hits };
    });
    const name = `batch-${String(batchCount).padStart(3, '0')}.json`;
    writeFileSync(join(batchesDir, name), `${JSON.stringify({ run_id: runId, batch: batchCount, rules: slice }, null, 1)}\n`);
    writeFileSync(join(batchesDir, name.replace(/\.json$/, '.txt')), renderBatchText(runId, batchCount, slice));
  }

  const tmp = `${exportPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ run_id: runId, exported_at: exportedAt, totalCount, rules }, null, 1)}\n`);
  renameSync(tmp, exportPath);

  process.stdout.write(`${JSON.stringify({
    run_id: runId,
    status: 'exported',
    totalCount,
    exported: rules.length,
    pages,
    page_size: pageSize,
    batches: batchCount,
    batch_size: BATCH_SIZE,
    guard_hit_rules: guardHitRules,
    guard_terms: effective.guard_terms,
    export: exportPath,
    batches_dir: batchesDir,
  })}\n`);
}

main();
