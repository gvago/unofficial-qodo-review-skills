#!/usr/bin/env node
// verify.mjs — re-read the workspace and check it against the receipt. Writes no severity.
//
// Usage:
//   node verify.mjs --run <run-dir> --qodo <launcher> [--read-args "read rules list"]
//
// The receipt says what the apply loop *reported* per row, which is not the same as what the
// workspace now holds: a row that timed out or printed garbage may well have landed, and an
// `applied` whose response carried no severity (`severity_verified: false`) is only a claim. So
// verify pages the whole active set through the same reader the export uses — never a per-rule
// `rules get` — and compares each approve/override row's live severity to the one the receipt
// expects:
//
//   apply state `applied`  → expect the row's target
//   anything else          → expect the row's current
//
// where a row's apply state is its last status token other than `verified`/`mismatch(…)`, and
// `failed(revert:<code>)` counts as `applied` (the revert did not take). Skipped, `[?]`-deferred
// and invalid rows are never read against.
//
// Each compared row gains `· verified` or `· mismatch(<actual>)`; a rule that is gone from the
// workspace gets `mismatch(missing)`. Results are appended to apply-results.jsonl first and the
// receipt is rewritten from them, so a crash between the two loses nothing. This is the only
// script in the skill that reads the workspace after apply, and it writes nothing to it.
//
// Exit codes: 0 every compared row verified, 3 at least one mismatch (each listed), 2 refused
// (no receipt, a receipt from another run, or the re-read failed — the receipt is untouched),
// 1 usage / Node too old.

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { requireNode20 } from './lib/calibrate-lib.mjs';
import { DEFAULT_READ_ARGS, ExportError, fetchAll } from './lib/export-lib.mjs';
import { RunError } from './lib/proposal-lib.mjs';
import { readback } from './lib/readback-lib.mjs';
import {
  EXIT, RECEIPT_FILE, RESULTS_FILE,
  foldResults, isRevertCandidate, parseReceipt, readResults, setFrontmatter, severityWord,
  stripStatuses,
} from './lib/receipt-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`verify: ${message}\n`);
  process.exit(code);
}

// How many ordinary out-of-scope rows the report lists before it starts counting them instead.
// A row the apply changed is never subject to the cap. The override is gated on
// CALIBRATE_TEST_MODE, like the apply backoff, so a stray variable cannot shrink a real report.
const DEFAULT_OUT_OF_SCOPE_CAP = 50;
const OUT_OF_SCOPE_CAP = process.env.CALIBRATE_TEST_MODE === '1' && Number(process.env.CALIBRATE_OUT_OF_SCOPE_CAP) > 0
  ? Number(process.env.CALIBRATE_OUT_OF_SCOPE_CAP)
  : DEFAULT_OUT_OF_SCOPE_CAP;

const USAGE = `usage: node verify.mjs --run <run-dir> --qodo <launcher> [--read-args "${DEFAULT_READ_ARGS}"]\n`;

function parseArgs(argv) {
  const args = { run: null, qodo: 'qodo', readArgs: DEFAULT_READ_ARGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(EXIT.usage, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--qodo') args.qodo = next();
    else if (a === '--read-args') args.readArgs = next();
    else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else fail(EXIT.usage, `unknown argument: ${a}`);
  }
  if (!args.run) {
    process.stderr.write(USAGE);
    fail(EXIT.usage, '--run <run-dir> is required');
  }
  args.readWords = args.readArgs.trim().split(/\s+/).filter(Boolean);
  if (!args.readWords.length) fail(EXIT.usage, `--read-args must name the rules-list read command, e.g. "${DEFAULT_READ_ARGS}"`);
  return args;
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const runId = basename(runDir);
  const receiptPath = join(runDir, RECEIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);

  if (!existsSync(receiptPath)) fail(EXIT.refused, `${receiptPath} missing — there is nothing to verify until an apply has written a receipt. Nothing written.`);
  let receiptText;
  try {
    receiptText = readFileSync(receiptPath, 'utf8');
  } catch (e) {
    fail(EXIT.refused, `${receiptPath} cannot be read (${e.message}). Nothing written.`);
  }
  const head = parseReceipt(receiptText);
  if (head.error === 'missing') fail(EXIT.refused, `${receiptPath} has no frontmatter — do not hand-write the file. Nothing written.`);
  if (head.error === 'unterminated') fail(EXIT.refused, `${receiptPath} frontmatter is not terminated — the closing \`---\` line is missing. Nothing written.`);
  if (String(head.frontmatter.run_id ?? '') !== runId) {
    fail(EXIT.refused, `${receiptPath} frontmatter run_id "${head.frontmatter.run_id ?? ''}" does not match the run folder "${runId}" — the file belongs to another run. Nothing written.`);
  }

  // Close any gap between the results file and the receipt before comparing, so a row whose apply
  // result never made it into the receipt is compared against the state it actually reached.
  receiptText = foldResults(receiptText, readResults(resultsPath)).text;

  let result;
  try {
    result = readback(runDir, { file: RECEIPT_FILE, text: stripStatuses(receiptText) });
  } catch (e) {
    if (e instanceof RunError) fail(e.code, `${e.message} Nothing written.`);
    throw e;
  }
  const parsed = parseReceipt(receiptText);
  const rowOf = new Map();
  for (const row of parsed.rows) if (row.ok) rowOf.set(String(row.rule_id), row);

  // The re-read happens before anything is written: a failed re-read leaves the receipt alone.
  let live;
  try {
    live = fetchAll(args.qodo, args.readWords, { name: 'verify' });
  } catch (e) {
    if (e instanceof ExportError) fail(EXIT.refused, `${e.message} The receipt is unchanged and no result was recorded.`);
    throw e;
  }
  // The same check the export makes: a duplicate id across pages means the page window moved
  // under us, and silently letting the last page win would compare against the wrong rule.
  const severityOf = new Map();
  for (const rule of live.rules) {
    const key = String(rule.ruleId);
    if (severityOf.has(key)) {
      fail(EXIT.refused, `duplicate ruleId ${rule.ruleId} across pages; read ${live.rules.length} of ${live.totalCount} in ${live.pages} pages. The receipt is unchanged and no result was recorded.`);
    }
    severityOf.set(key, rule.severity);
  }

  const at = new Date().toISOString();
  const compared = [];
  const mismatches = [];
  const outOfScope = [];
  const lines = [];
  for (const r of result.rows) {
    const key = String(r.rule_id);
    const row = rowOf.get(key);
    const applyStateOf = row?.apply_state ?? 'pending';
    // Only the rows the checklist still approves are compared. The rest are named in the report
    // rather than dropped: an admin who unchecks an already-`· applied` row in receipt.md turns it
    // into a skip here, and a report that simply omitted it would claim a clean verify while the
    // rule sat at the apply target.
    if (r.decision !== 'approve' && r.decision !== 'override') {
      outOfScope.push({
        rule_id: r.rule_id,
        reason: r.decision === 'skip' ? 'unchecked in the checklist' : 'deferred with [?]',
        decision: r.decision,
        apply_status: applyStateOf,
        apply_token: row?.apply_token ?? null,
        changed_by_apply: isRevertCandidate({ statuses: row?.statuses ?? [], current: r.current }),
      });
      continue;
    }
    // `applied` is the only state that claims the target was written; every other state — a
    // failure, a defer, a pending row, a reverted row — leaves the rule at `current`.
    const expected = applyStateOf === 'applied' ? r.target : r.current;
    const present = severityOf.has(key);
    // A severity that is present but unusable (null, blank, or carrying a character that would
    // break the token grammar) is reported as `unknown`: it still disagrees with the receipt,
    // which is the finding, and the row stays parseable.
    const actual = present ? severityWord(severityOf.get(key)) : 'missing';
    const ok = present && actual !== 'unknown' && same(actual, expected);
    const entry = {
      rule_id: r.rule_id,
      apply_status: applyStateOf,
      apply_token: row?.apply_token ?? null,
      expected,
      actual,
      // The one case worth calling out in prose: the receipt says the write failed, and the
      // workspace is sitting at the target anyway.
      landed_despite_failure: !ok && applyStateOf === 'failed' && present && same(actual, r.target),
    };
    compared.push(entry);
    if (!ok) mismatches.push(entry);
    lines.push(JSON.stringify({
      rule_id: r.rule_id,
      phase: 'verify',
      status: ok ? 'verified' : 'mismatch',
      apply_status: applyStateOf,
      expected,
      actual,
      at,
    }));
  }

  // Results first, then the receipt derived from them — the same order apply uses.
  if (lines.length) appendFileSync(resultsPath, `${lines.join('\n')}\n`);
  receiptText = foldResults(receiptText, readResults(resultsPath)).text;
  receiptText = setFrontmatter(receiptText, { verified_at: at, verify_mismatches: mismatches.length });
  writeAtomic(receiptPath, receiptText);

  const exitCode = mismatches.length ? EXIT.report : EXIT.applied;
  for (const m of mismatches) {
    process.stderr.write(`verify: rule ${m.rule_id} ${m.apply_token ?? 'pending'} — expected "${m.expected}", workspace holds "${m.actual}"${m.landed_despite_failure ? ' — the write landed despite the reported failure' : ''}\n`);
  }
  // An out-of-scope row the apply changed is not a mismatch (it was never compared) but it is the
  // one thing an admin must not miss: the rule is still at the target and nothing in the counts
  // says so.
  const warnings = outOfScope
    .filter((r) => r.changed_by_apply)
    .map((r) => `rule ${r.rule_id} is not compared (${r.reason}) but the receipt reads \`· ${r.apply_token}\` — the apply changed it and it is still at the target; revert it or re-approve the row`);
  for (const w of warnings) process.stderr.write(`verify: ${w}\n`);
  // Changed-by-apply rows first and always; then ordinary ones up to the cap, so the report stays
  // one short line on a workspace where the admin deferred hundreds of rows.
  // The cap bounds the ordinary rows only: a changed row is exempt, so it can never be pushed out
  // of the list by a workspace with a long tail of deferred ones.
  const reportedOutOfScope = [
    ...outOfScope.filter((r) => r.changed_by_apply),
    ...outOfScope.filter((r) => !r.changed_by_apply).slice(0, OUT_OF_SCOPE_CAP),
  ];
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    run_id: runId,
    phase: 'verify',
    // `nothing_to_verify` is not the same statement as a clean verify: zero compared rows means
    // the receipt had no approved row to read against, not that the workspace matched.
    status: mismatches.length ? 'mismatched' : compared.length ? 'verified' : 'nothing_to_verify',
    counts: {
      checked: compared.length,
      verified: compared.length - mismatches.length,
      mismatch: mismatches.length,
      out_of_scope: outOfScope.length,
      active_rules: live.totalCount,
    },
    mismatches,
    // The rows the readback did not put in scope, by id and reason. A workspace where the admin
    // deferred most of the proposal has hundreds of these, and the orchestrator reads this report
    // in full: every row the apply changed is always listed (that is the one an admin must not
    // miss), the rest are listed only up to the cap and counted in `out_of_scope_omitted`.
    out_of_scope: reportedOutOfScope,
    out_of_scope_omitted: outOfScope.length - reportedOutOfScope.length,
    invalid: result.invalid,
    pages: live.pages,
    page_size: live.pageSize,
    verified_at: at,
    receipt: receiptPath,
    results: resultsPath,
    warnings,
    exit_code: exitCode,
  })}\n`);
  process.exit(exitCode);
}

main();
