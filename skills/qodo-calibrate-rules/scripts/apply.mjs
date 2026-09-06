#!/usr/bin/env node
// apply.mjs — apply the confirmed severity decisions, one row at a time, from a generated script.
//
// Usage:
//   node apply.mjs --run <run-dir> --generate [--revert] --qodo <launcher> [--update-args "rules update"]
//   node apply.mjs --run <run-dir> --row <rule-id> --target <severity> [--revert] --qodo <launcher> [--update-args "…"]
//   node apply.mjs --run <run-dir> --write-receipt [--revert]
//
// `--revert` runs the same three-step loop backwards: the target column becomes each row's
// `current` severity, the script is revert.sh, the idempotency key is
// calibrate-revert-<run-id>-<rule-id>, and no ledger entry is written (an `approve` holds only
// while the rule sits at the approved severity, so a reverted rule is re-proposed by itself).
// Once a run has been reverted it is closed for apply: --generate and --row refuse.
//
// --generate reads the admin's decisions back (from receipt.md when it exists, otherwise
// proposal.md), writes <run-dir>/receipt.md, and writes <run-dir>/apply.sh: one `row` line per
// approve/override decision in file order, a loop that stops on the abort exit code, and a final
// --write-receipt. Rows already `applied` are never regenerated, so re-running --generate after an
// interruption resumes. proposal.md is never modified.
//
// --row performs exactly one `qodo rules update --rule-id <id> --severity <target>` — the only
// field this skill writes — appends every attempt to <run-dir>/apply-results.jsonl, then rewrites
// receipt.md from the receipt's rows plus all results. It is meant to be called by apply.sh, never
// row by row from the agent.
//
// --write-receipt folds the results into the receipt, stamps applied_at / apply_exit_code, records
// the applied rows in the decisions ledger, and prints the run report.
//
// Exit codes: --row 0 applied, 10 failed, 20 deferred, 30 abort (the loop stops);
// --write-receipt 0 every row applied, 3 otherwise; 1 usage / Node too old, 2 refused.

import { chmodSync, existsSync, appendFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSeverity, requireNode20 } from './lib/calibrate-lib.mjs';
import { classifyError, errorOf, forwardStderr, parseJsonOutput, sleep, spawnLauncher, stderrTail, TIMEOUT_MS } from './lib/launcher-lib.mjs';
import { appendEntries, contentHash, latestByRule, ledgerPath, makeEntry, readLedger } from './lib/ledger-lib.mjs';
import { hasContent, RunError } from './lib/proposal-lib.mjs';
import { readback, recordSkips } from './lib/readback-lib.mjs';
import {
  DEFAULT_UPDATE_ARGS, EXIT, RECEIPT_FILE, RESULTS_FILE, REVERT_SCRIPT_FILE, SCRIPT_FILE,
  applyPhaseState, applyState, foldResults, isRevertCandidate, isRowLine, lastResultByRule,
  markRows, parseReceipt, readResults, renderApplyScript, setFrontmatter, splitStatus,
  stripStatuses, updateArgv,
} from './lib/receipt-lib.mjs';

requireNode20();

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const MAX_RETRIES = 5;
const DEFAULT_BACKOFF_MS = 2000;
// The backoff override is gated on CALIBRATE_TEST_MODE so a stray CALIBRATE_BACKOFF_MS left in a
// shell profile cannot turn a real rate-limited run into five instant retries against the API.
const BACKOFF_BASE_MS = process.env.CALIBRATE_TEST_MODE === '1' && Number(process.env.CALIBRATE_BACKOFF_MS) > 0
  ? Number(process.env.CALIBRATE_BACKOFF_MS)
  : DEFAULT_BACKOFF_MS;
const ROW_TIMEOUT_MS = Number(process.env.CALIBRATE_TIMEOUT_MS) > 0 ? Number(process.env.CALIBRATE_TIMEOUT_MS) : TIMEOUT_MS;
// A row that is already `applied` or `skipped` is settled; only these need the launcher.
const SETTLED = Object.freeze(['applied', 'skipped']);

function fail(code, message) {
  process.stderr.write(`apply: ${message}\n`);
  process.exit(code);
}

const USAGE = `usage: node apply.mjs --run <run-dir> --generate [--revert] --qodo <launcher> [--update-args "${DEFAULT_UPDATE_ARGS}"]
       node apply.mjs --run <run-dir> --row <rule-id> --target <severity> [--revert] --qodo <launcher> [--update-args "…"]
       node apply.mjs --run <run-dir> --write-receipt [--revert]\n`;

function parseArgs(argv) {
  const args = { run: null, generate: false, writeReceipt: false, row: null, target: null, revert: false, qodo: 'qodo', updateArgs: DEFAULT_UPDATE_ARGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(EXIT.usage, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--generate') args.generate = true;
    else if (a === '--write-receipt') args.writeReceipt = true;
    else if (a === '--row') args.row = next();
    else if (a === '--target') args.target = next();
    else if (a === '--revert') args.revert = true;
    else if (a === '--qodo') args.qodo = next();
    else if (a === '--update-args') args.updateArgs = next();
    else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else fail(EXIT.usage, `unknown argument: ${a}`);
  }
  if (!args.run) fail(EXIT.usage, '--run <run-dir> is required');
  const modes = [args.generate, args.writeReceipt, args.row !== null].filter(Boolean).length;
  if (modes !== 1) {
    process.stderr.write(USAGE);
    fail(EXIT.usage, 'pass exactly one of --generate, --row, --write-receipt');
  }
  if (args.row !== null) {
    if (!/^\d+$/.test(String(args.row).trim())) fail(EXIT.usage, `--row must be a rule id, got "${args.row}"`);
    args.row = String(args.row).trim();
    if (!args.target) fail(EXIT.usage, '--row needs --target <severity>');
  }
  args.updateWords = args.updateArgs.trim().split(/\s+/).filter(Boolean);
  if (!args.updateWords.length) fail(EXIT.usage, `--update-args must name the rules-update command, e.g. "${DEFAULT_UPDATE_ARGS}"`);
  return args;
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readbackOr(runDir, options) {
  try {
    return readback(runDir, options);
  } catch (e) {
    if (e instanceof RunError) fail(e.code, e.message);
    throw e;
  }
}

// The row lines of a checklist, stripped of any status token: the comparison that says whether an
// edited proposal.md still describes the same decisions as the receipt.
function rowLines(text) {
  return String(text).split('\n').filter(isRowLine).map((l) => splitStatus(l).row.trim());
}

// Reads a checklist file and checks its frontmatter run_id names this run folder. Returns
// { text } or { error } — the caller decides whether the problem is fatal, because a broken
// proposal.md on a resume is only a warning (the receipt is the source of truth) while a broken
// receipt is a refusal.
function readChecklist(path, runId) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { error: `${path} cannot be read (${e.message})` };
  }
  const parsed = parseReceipt(text);
  if (parsed.error === 'missing') return { error: `${path} has no frontmatter — do not hand-write the file` };
  if (parsed.error === 'unterminated') return { error: `${path} frontmatter is not terminated — the closing \`---\` line is missing` };
  if (String(parsed.frontmatter.run_id ?? '') !== runId) {
    return { error: `${path} frontmatter run_id "${parsed.frontmatter.run_id ?? ''}" does not match the run folder "${runId}" — the file belongs to another run` };
  }
  return { text };
}

function checkRunId(path, runId) {
  const res = readChecklist(path, runId);
  if (res.error) fail(EXIT.refused, `${res.error}. Nothing written.`);
  return res.text;
}

// ---------------------------------------------------------------------------------------
// --generate

// Once `reverted_at` is stamped, the run's rows are back where they started and its receipt no
// longer describes the workspace: applying it again would re-write the severities the admin just
// undid. A new run re-exports, re-classifies, and asks again.
function refuseClosedRun(frontmatter, runId, what) {
  if (!frontmatter?.reverted_at) return;
  fail(EXIT.refused, `run ${runId} was reverted (reverted_at ${frontmatter.reverted_at}) — this run is closed for apply; start a new run. ${what} wrote nothing.`);
}

function generate(args, runDir, runId) {
  const receiptPath = join(runDir, RECEIPT_FILE);
  const proposalPath = join(runDir, 'proposal.md');
  const scriptPath = join(runDir, SCRIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);

  if (!existsSync(receiptPath) && !existsSync(proposalPath)) {
    fail(EXIT.refused, `${proposalPath} missing — render the proposal and read it back before applying anything.`);
  }

  const warnings = [];
  const resuming = existsSync(receiptPath);
  const results = readResults(resultsPath);
  let receiptText;
  if (resuming) {
    receiptText = checkRunId(receiptPath, runId);
    // A crash between the results append and the receipt rewrite leaves a gap: close it first so
    // the resume never re-applies a row whose result is already on disk.
    receiptText = foldResults(receiptText, results).text;
    if (existsSync(proposalPath)) {
      const proposal = readChecklist(proposalPath, runId);
      // A proposal.md that cannot be read, or that belongs to another run, does not stop a
      // resume: the receipt carries the decisions the apply is working from.
      if (proposal.error) warnings.push(`${proposal.error}; proposal.md unreadable or belongs to another run — ignored, ${receiptPath} is the source of truth`);
      else if (rowLines(proposal.text).join('\n') !== rowLines(receiptText).join('\n')) {
        warnings.push(`${proposalPath} rows differ from ${receiptPath}; resuming from the receipt — proposal.md is ignored`);
      }
    }
  } else {
    receiptText = checkRunId(proposalPath, runId);
    // The receipt is gone but its results are not: fold them back in so a row that already
    // applied is not sent a second time just because the file was deleted.
    if (results.length) {
      receiptText = foldResults(receiptText, results).text;
      warnings.push(`${receiptPath} was missing while ${resultsPath} holds ${results.length} recorded attempt(s) — rebuilt the receipt from proposal.md and folded them in, so rows already applied are not sent again`);
    }
  }

  const source = resuming ? RECEIPT_FILE : 'proposal.md';
  const result = readbackOr(runDir, { file: source, text: stripStatuses(receiptText) });
  const parsed = parseReceipt(receiptText);
  refuseClosedRun(parsed.frontmatter, runId, '--generate');
  // The apply state, not the effective status: a `· applied · verified` row is still applied.
  const statusOf = new Map();
  for (const row of parsed.rows) if (row.ok) statusOf.set(String(row.rule_id), row.apply_state);

  const decisions = result.rows.filter((r) => r.decision === 'approve' || r.decision === 'override');
  const alreadyApplied = decisions.filter((r) => statusOf.get(String(r.rule_id)) === 'applied').map((r) => r.rule_id);
  const alreadySkipped = decisions.filter((r) => statusOf.get(String(r.rule_id)) === 'skipped').map((r) => r.rule_id);
  // A settled row never goes back in the script: `applied` is done, and a `· skipped` token is a
  // decision already taken even if the checkbox was ticked again afterwards.
  const rows = decisions.filter((r) => !SETTLED.includes(statusOf.get(String(r.rule_id))));
  const skips = result.rows.filter((r) => r.decision === 'skip');

  // Unchecked rows carry `· skipped` so the receipt says why nothing happened to them.
  receiptText = markRows(receiptText, skips.map((r) => r.rule_id), 'skipped').text;
  writeAtomic(receiptPath, receiptText);

  // The skips go on record here as well as in `approve.mjs --record-skips`, through the same
  // helper: the two-step order is documented, but a missed step must not lose the admin's skips.
  const skipsRecorded = recordSkips(result);
  warnings.push(...skipsRecorded.warnings);

  const report = {
    run_dir: runDir,
    run_id: runId,
    source,
    receipt: receiptPath,
    results: resultsPath,
    rows_to_apply: rows.length,
    rule_ids: rows.map((r) => r.rule_id),
    already_applied: alreadyApplied,
    already_skipped: alreadySkipped,
    skipped: skips.length,
    skips_recorded: skipsRecorded.recorded,
    ledger_path: skipsRecorded.ledger_path,
    invalid: result.invalid,
    removed_ids: result.removedIds,
    counts: result.counts,
    readback_text: result.readback_text,
    warnings,
  };

  for (const w of warnings) process.stderr.write(`apply: ${w}\n`);

  if (!rows.length) {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
    process.stdout.write(`${JSON.stringify({ ...report, status: 'nothing_to_apply', script: null })}\n`);
    return;
  }

  writeAtomic(scriptPath, renderApplyScript({
    runDir,
    scriptsDir: SCRIPTS_DIR,
    launcher: args.qodo,
    updateArgs: args.updateArgs,
    runId,
    rows,
  }));
  chmodSync(scriptPath, 0o755);
  process.stdout.write(`${JSON.stringify({ ...report, status: 'generated', script: scriptPath })}\n`);
}

// ---------------------------------------------------------------------------------------
// --generate --revert

// Why a row is not in the revert. Plain language, because this lands in the report the agent reads
// back to the admin.
function reasonForNonCandidate(state, statuses) {
  const verify = statuses.find((t) => /^mismatch\(missing\)$/.test(t));
  if (verify) return 'the rule is gone from the active set';
  switch (state) {
    case 'skipped': return 'the admin never approved it, so nothing was written';
    case 'failed': return 'the apply failed and a verify found the rule still at its current severity';
    case 'deferred': return 'the apply deferred it, so nothing was written';
    case 'pending': return 'the apply never reached it';
    default: return `apply state ${state}`;
  }
}

// The revert generator is the apply generator with one column changed: the target is each row's
// `current`. It reads only receipt.md — proposal.md cannot say what the loop did — and selects the
// rows the receipt believes are no longer at `current`.
//
// Selection is on the row's **apply state**, not on its checkbox. That matters for one nasty case:
// an admin who unchecks an already-`· applied` row in receipt.md turns it into a `skip` in the
// readback, and a decision-keyed selection would leave the rule sitting at the apply target while
// reporting a clean revert. The receipt shows the row as changed, so revert owns it.
function generateRevert(args, runDir, runId) {
  const receiptPath = join(runDir, RECEIPT_FILE);
  const scriptPath = join(runDir, REVERT_SCRIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);

  if (!existsSync(receiptPath)) {
    fail(EXIT.refused, `${receiptPath} missing — a revert is generated from the receipt of an apply, and this run has none. Nothing written.`);
  }
  let receiptText = checkRunId(receiptPath, runId);
  const results = readResults(resultsPath);
  // Pending results first, exactly as apply does: a crash between the results append and the
  // receipt rewrite must not make a reverted row look like a candidate again.
  receiptText = foldResults(receiptText, results).text;

  const result = readbackOr(runDir, { file: RECEIPT_FILE, text: stripStatuses(receiptText) });
  const parsed = parseReceipt(receiptText);
  const rowOf = new Map();
  for (const row of parsed.rows) if (row.ok) rowOf.set(String(row.rule_id), row);

  const rows = [];
  const alreadyReverted = [];
  const notCandidates = [];
  const unchecked = [];
  for (const r of result.rows) {
    const statuses = rowOf.get(String(r.rule_id))?.statuses ?? [];
    const state = applyState(statuses);
    if (state === 'reverted') { alreadyReverted.push(r.rule_id); continue; }
    if (isRevertCandidate({ statuses, current: r.current })) {
      rows.push({ rule_id: r.rule_id, target: r.current, apply_state: state });
      // Worth saying out loud: this row is only in the revert because the receipt says the apply
      // changed it, even though the checklist no longer approves it.
      if (r.decision !== 'approve' && r.decision !== 'override') unchecked.push({ rule_id: r.rule_id, decision: r.decision, apply_state: state });
      continue;
    }
    notCandidates.push({ rule_id: r.rule_id, decision: r.decision, apply_state: state, reason: reasonForNonCandidate(state, statuses) });
  }

  const warnings = unchecked.map((u) => `rule ${u.rule_id} is \`${u.decision}\` in the checklist but \`· ${u.apply_state}\` in the receipt — the apply changed it, so the revert includes it`);
  for (const w of warnings) process.stderr.write(`apply: ${w}\n`);

  writeAtomic(receiptPath, receiptText);

  const report = {
    run_dir: runDir,
    run_id: runId,
    source: RECEIPT_FILE,
    receipt: receiptPath,
    results: resultsPath,
    rows_to_revert: rows.length,
    rule_ids: rows.map((r) => r.rule_id),
    targets: Object.fromEntries(rows.map((r) => [r.rule_id, r.target])),
    already_reverted: alreadyReverted,
    // Every row the revert is not touching, by id, with why — so an unchecked-but-applied row can
    // never be silently absent from the report.
    not_candidates: notCandidates,
    unchecked_but_changed: unchecked,
    invalid: result.invalid,
    warnings,
  };

  if (!rows.length) {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
    process.stdout.write(`${JSON.stringify({ ...report, status: 'nothing_to_revert', script: null })}\n`);
    return;
  }

  writeAtomic(scriptPath, renderApplyScript({
    runDir,
    scriptsDir: SCRIPTS_DIR,
    launcher: args.qodo,
    updateArgs: args.updateArgs,
    runId,
    rows,
    mode: 'revert',
  }));
  chmodSync(scriptPath, 0o755);
  process.stdout.write(`${JSON.stringify({ ...report, status: 'generated', script: scriptPath })}\n`);
}

// ---------------------------------------------------------------------------------------
// --row

// Where a `rules update` response has been seen to put the updated severity. The frozen success
// rule is exit 0 plus a JSON object with no error; this is the corroborating evidence, looked for
// wherever the CLI might have put it rather than at the top level only.
const SEVERITY_HOLDERS = Object.freeze(['rule', 'result', 'data']);

function severityIn(payload) {
  const at = (o) => (o && typeof o === 'object' && !Array.isArray(o) && o.severity !== undefined && o.severity !== null ? String(o.severity) : null);
  const top = at(payload);
  if (top !== null) return top;
  for (const key of SEVERITY_HOLDERS) {
    const nested = at(payload[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function attemptUpdate(args, runId, ruleId, target, mode = 'apply') {
  const argv = updateArgv({ updateArgs: args.updateWords, ruleId, target, runId, mode });
  const res = spawnLauncher(args.qodo, argv, { timeout: ROW_TIMEOUT_MS });
  const key = argv[argv.length - 1];
  if (res.error) {
    const err = res.error.code === 'ETIMEDOUT'
      ? { code: 'timeout', message: `rule ${ruleId} did not finish within ${ROW_TIMEOUT_MS} ms` }
      : { code: 'spawn_failed', message: `${args.qodo}: ${res.error.message}` };
    return { key, error: err, tail: stderrTail(res.stderr) };
  }
  forwardStderr(res.stderr);
  const tail = stderrTail(res.stderr);
  const parsedOut = parseJsonOutput(res.stdout);
  if (parsedOut.error) return { key, error: parsedOut.error, tail, stderr: res.stderr };
  const err = errorOf(parsedOut.payload);
  if (err) return { key, error: err, tail, stderr: res.stderr };
  if (res.status !== 0) return { key, error: { code: 'non_zero_exit', message: `launcher exited ${res.status}` }, tail, stderr: res.stderr };
  const { payload } = parsedOut;
  // A response that names a severity must name the one we asked for — case-insensitively, since
  // the display casing is not the skill's business. Otherwise the workspace is not in the state
  // the receipt would claim.
  const reported = severityIn(payload);
  if (reported !== null && reported.toLowerCase() !== String(target).toLowerCase()) {
    return { key, error: { code: 'response_mismatch', message: `rule ${ruleId} came back at severity "${reported}", not "${target}"` }, tail, stderr: res.stderr };
  }
  // No severity anywhere in the response is still a success by the frozen rule, but it is
  // unconfirmed: the result line says so and verify is what settles it.
  return { key, payload, severityVerified: reported !== null, tail, stderr: res.stderr };
}

function applyRow(args, runDir, runId) {
  const reverting = args.revert;
  const phase = reverting ? 'revert' : 'apply';
  const scriptName = reverting ? REVERT_SCRIPT_FILE : SCRIPT_FILE;
  const receiptPath = join(runDir, RECEIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);
  if (!existsSync(receiptPath)) fail(EXIT.refused, `${receiptPath} missing — run --generate before ${scriptName}.`);
  const receiptText = checkRunId(receiptPath, runId);
  if (!isSeverity(args.target)) fail(EXIT.refused, `--target "${args.target}" is not a severity (error|warning|recommendation)`);

  const parsed = parseReceipt(receiptText);
  if (!reverting) refuseClosedRun(parsed.frontmatter, runId, '--row');
  const row = parsed.rows.find((r) => r.ok && String(r.rule_id) === args.row);
  if (!row) fail(EXIT.refused, `rule ${args.row} has no row in ${receiptPath} — regenerate ${scriptName} from this run's receipt.`);
  if (!reverting && row.apply_state === 'applied') {
    process.stdout.write(`${JSON.stringify({ rule_id: Number(args.row), status: 'already_applied', target: args.target, receipt: receiptPath })}\n`);
    return EXIT.applied;
  }
  if (reverting && row.apply_state === 'reverted') {
    process.stdout.write(`${JSON.stringify({ rule_id: Number(args.row), status: 'already_reverted', target: args.target, receipt: receiptPath })}\n`);
    return EXIT.applied;
  }
  // The script is generated from the receipt, so a disagreement means the receipt moved on and
  // the script did not. Refuse rather than write a severity the receipt does not claim — and
  // record the refusal as an abort, so the loop's own report names the row it stopped on.
  const stale = `${scriptName} is stale — regenerate it (apply.mjs --run <run-dir> --generate${reverting ? ' --revert' : ''}) and run the new script; nothing written.`;
  const refuse = (code, why) => {
    appendFileSync(resultsPath, `${JSON.stringify({
      rule_id: Number(args.row),
      phase,
      target: args.target,
      current: row.current,
      status: 'aborted',
      code,
      message: why,
      severity_verified: false,
      attempt: 0,
      idempotency_key: null,
      at: new Date().toISOString(),
    })}\n`);
    fail(EXIT.refused, `${why} ${stale}`);
  };
  if (reverting) {
    // A revert may only touch a row the receipt shows as changed, and only back to its `current`.
    if (!isRevertCandidate(row)) {
      refuse('stale_script', `rule ${args.row} is not a revert candidate in ${receiptPath} (apply state ${row.apply_state}) — the receipt does not show it changed.`);
    }
    if (String(row.current) !== String(args.target)) {
      refuse('stale_script', `rule ${args.row} reverts to "${row.current}" in ${receiptPath} but ${scriptName} asks for "${args.target}".`);
    }
  } else {
    if (row.apply_state === 'skipped') refuse('stale_script', `rule ${args.row} is already \`· skipped\` in ${receiptPath}.`);
    if (!row.checked) refuse('stale_script', `rule ${args.row} is not checked in ${receiptPath} — the admin skipped or deferred it.`);
    if (String(row.target) !== String(args.target)) {
      refuse('stale_script', `rule ${args.row} reads "${row.target}" in ${receiptPath} but ${scriptName} asks for "${args.target}".`);
    }
  }

  const ruleId = Number(args.row);
  let status = null;
  let code = null;
  let message = null;
  let severityVerified = false;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const res = attemptUpdate(args, runId, ruleId, args.target, phase);
    severityVerified = res.severityVerified === true;
    if (!res.error) {
      status = reverting ? 'reverted' : 'applied';
      code = null;
      message = null;
      if (!severityVerified) {
        process.stderr.write(`apply: rule ${ruleId} response carried no severity; verify will confirm\n`);
      }
    } else {
      const klass = classifyError(res.error, res.stderr ?? '');
      code = res.error.code;
      message = res.error.message;
      if (klass === 'retry') status = attempt <= MAX_RETRIES ? 'retrying' : 'deferred';
      else if (klass === 'abort') status = 'aborted';
      else status = 'failed';
    }
    appendFileSync(resultsPath, `${JSON.stringify({
      rule_id: ruleId,
      phase,
      target: args.target,
      current: row.current,
      status,
      code,
      message: message ? String(message).slice(0, 300) : null,
      severity_verified: severityVerified,
      attempt,
      idempotency_key: res.key,
      at: new Date().toISOString(),
    })}\n`);
    if (status !== 'retrying') break;
    const waitMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    process.stderr.write(`apply: rule ${ruleId} ${code}; retry ${attempt} of ${MAX_RETRIES} in ${waitMs} ms\n`);
    sleep(waitMs);
  }

  // The results file is the record; the receipt is derived from it, so the append above always
  // happens first and a crash here loses nothing.
  writeAtomic(receiptPath, foldResults(receiptText, readResults(resultsPath)).text);

  const settled = reverting ? 'reverted' : 'applied';
  const exitCode = status === settled ? EXIT.applied
    : status === 'deferred' ? EXIT.deferred
      : status === 'aborted' ? EXIT.abort : EXIT.failed;
  if (status !== settled) {
    process.stderr.write(`apply: rule ${ruleId} ${status}${code ? ` (${code})` : ''}${status === 'aborted' ? ' — abort class, the loop stops and the remaining rows stay pending' : ''}\n`);
  }
  process.stdout.write(`${JSON.stringify({ rule_id: ruleId, phase, target: args.target, status, code, receipt: receiptPath, exit_code: exitCode })}\n`);
  return exitCode;
}

// ---------------------------------------------------------------------------------------
// --write-receipt

function writeReceipt(runDir, runId) {
  const receiptPath = join(runDir, RECEIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);
  if (!existsSync(receiptPath)) fail(EXIT.refused, `${receiptPath} missing — run --generate first.`);
  let receiptText = checkRunId(receiptPath, runId);
  // A pre-revert apply.sh run again after a revert would re-stamp applied_at / apply_exit_code and
  // append ledger entries for rows that are no longer at the target. Refuse before writing.
  refuseClosedRun(parseReceipt(receiptText).frontmatter, runId, '--write-receipt');
  const results = readResults(resultsPath);
  receiptText = foldResults(receiptText, results).text;

  const result = readbackOr(runDir, { file: RECEIPT_FILE, text: stripStatuses(receiptText) });
  const parsed = parseReceipt(receiptText);
  // The apply-phase view of each row: a later verify or revert token must not change what this
  // loop reports about itself. `applyPhaseState` therefore skips both classes.
  const statusOf = new Map();
  for (const row of parsed.rows) if (row.ok) statusOf.set(String(row.rule_id), applyPhaseState(row.statuses));
  // Apply-phase results only: a verify or revert result must not be read as this loop's outcome.
  const lastResult = lastResultByRule(results.filter((r) => (r.phase ?? 'apply') === 'apply'));

  const applyRows = result.rows.filter((r) => r.decision === 'approve' || r.decision === 'override');
  const stateOf = (r) => statusOf.get(String(r.rule_id)) ?? 'pending';
  const counts = {
    applied: applyRows.filter((r) => stateOf(r) === 'applied').length,
    failed: applyRows.filter((r) => stateOf(r) === 'failed').length,
    deferred: applyRows.filter((r) => stateOf(r) === 'deferred').length,
    pending: applyRows.filter((r) => stateOf(r) === 'pending').length,
    skipped: result.rows.filter((r) => r.decision === 'skip').length,
    deferred_by_admin: result.rows.filter((r) => r.decision === 'defer').length,
    invalid: result.invalid.length,
  };
  const nonApplied = applyRows
    .filter((r) => stateOf(r) !== 'applied')
    .map((r) => ({ rule_id: r.rule_id, status: stateOf(r), code: lastResult.get(String(r.rule_id))?.code ?? null }));
  // The loop aborted when any receipt row that did not end `applied` has an abort-class last
  // result. Every part of that matters: it is not keyed on the row being token-less (a row that
  // read `· failed(...)` and then hit an auth error on the resume still stopped this loop), and it
  // looks at every row rather than only today's apply rows (a row the admin unchecked after the
  // script was generated aborts on the stale script but is a skip by the time we report).
  const aborted = parsed.rows.some((r) => r.ok && applyPhaseState(r.statuses) !== 'applied' && lastResult.get(String(r.rule_id))?.status === 'aborted');
  const exitCode = nonApplied.length ? EXIT.report : EXIT.applied;

  // Only applied rows go in the ledger: a failed, deferred, or pending row was not decided into
  // the workspace, so it must be proposed again. Dedupe is per (run, rule).
  const path = ledgerPath();
  const latest = latestByRule(readLedger(path));
  const entries = [];
  const warnings = [];
  for (const r of applyRows.filter((row) => stateOf(row) === 'applied')) {
    const prior = latest.get(String(r.rule_id));
    if (prior && (prior.decision === 'approve' || prior.decision === 'override') && String(prior.run_id) === runId) continue;
    const rule = result.run.rules.get(String(r.rule_id));
    if (!hasContent(rule)) warnings.push(`rule ${r.rule_id} has no exported content — recorded without a content hash`);
    entries.push(makeEntry({
      rule_id: r.rule_id,
      decision: r.decision,
      severity_at_decision: r.target,
      content_hash: hasContent(rule) ? contentHash(rule.content) : null,
      run_id: runId,
    }));
  }
  appendEntries(entries, path);

  const times = results.filter((r) => (r.phase ?? 'apply') === 'apply').map((r) => r.at).filter(Boolean).sort();
  receiptText = setFrontmatter(receiptText, {
    applied_at: times.length ? times[times.length - 1] : new Date().toISOString(),
    apply_exit_code: exitCode,
  });
  writeAtomic(receiptPath, receiptText);

  if (nonApplied.length) {
    process.stderr.write(`apply: ${nonApplied.length} row${nonApplied.length === 1 ? '' : 's'} not applied: ${nonApplied.map((r) => `${r.rule_id} ${r.status}${r.code ? `(${r.code})` : ''}`).join(', ')}\n`);
  }
  for (const w of warnings) process.stderr.write(`apply: ${w}\n`);
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    run_id: runId,
    status: nonApplied.length ? 'incomplete' : 'applied',
    counts,
    non_applied: nonApplied,
    // The rows the readback excluded: they were never candidates for apply and are re-proposed
    // on the next run, so the final report has to show them.
    invalid: result.invalid,
    aborted,
    receipt: receiptPath,
    results: resultsPath,
    ledger_path: path,
    ledger_recorded: entries.length,
    readback_text: result.readback_text,
    warnings,
    exit_code: exitCode,
  })}\n`);
  return exitCode;
}

// ---------------------------------------------------------------------------------------
// --write-receipt --revert

// The same fold and report as apply's, over the revert candidates and with no ledger write: an
// `approve` entry holds a rule only while it still sits at the approved severity, so a reverted
// rule is re-proposed by the existing hold rule without anything being recorded here.
function writeReceiptRevert(runDir, runId) {
  const receiptPath = join(runDir, RECEIPT_FILE);
  const resultsPath = join(runDir, RESULTS_FILE);
  if (!existsSync(receiptPath)) fail(EXIT.refused, `${receiptPath} missing — run --generate --revert first.`);
  let receiptText = checkRunId(receiptPath, runId);
  const results = readResults(resultsPath);
  receiptText = foldResults(receiptText, results).text;

  const result = readbackOr(runDir, { file: RECEIPT_FILE, text: stripStatuses(receiptText) });
  const parsed = parseReceipt(receiptText);
  const rowOf = new Map();
  for (const row of parsed.rows) if (row.ok) rowOf.set(String(row.rule_id), row);
  const revertResults = results.filter((r) => r.phase === 'revert');
  const lastRevert = lastResultByRule(revertResults);

  // Every row this revert was responsible for: the ones already back at `current`, plus the ones
  // still believed to be at the apply target.
  const scope = [];
  const notCandidates = [];
  for (const r of result.rows) {
    const statuses = rowOf.get(String(r.rule_id))?.statuses ?? [];
    const state = applyState(statuses);
    if (state === 'reverted') { scope.push({ rule_id: r.rule_id, state: 'reverted' }); continue; }
    if (!isRevertCandidate({ statuses, current: r.current })) {
      notCandidates.push({ rule_id: r.rule_id, decision: r.decision, apply_state: state, reason: reasonForNonCandidate(state, statuses) });
      continue;
    }
    const last = lastRevert.get(String(r.rule_id));
    // Both a revert-phase `failed` and an exhausted rate limit fold to one token,
    // `failed(revert:<code>)`, so both must count as `failed` here — otherwise the JSON and the
    // receipt would describe the same row two different ways. An `aborted` row was never sent, so
    // it is pending, not failed.
    const state_ = last?.status === 'failed' || last?.status === 'deferred' ? 'failed' : 'pending';
    scope.push({ rule_id: r.rule_id, state: state_ });
  }

  const counts = {
    reverted: scope.filter((r) => r.state === 'reverted').length,
    failed: scope.filter((r) => r.state === 'failed').length,
    // Kept for shape stability and always 0: a revert never writes a `· deferred` token, because
    // an exhausted retry folds to `failed(revert:MT-RATE-LIMITED)` and is counted as failed.
    deferred: 0,
    pending: scope.filter((r) => r.state === 'pending').length,
    not_candidates: notCandidates.length,
  };
  const nonReverted = scope
    .filter((r) => r.state !== 'reverted')
    .map((r) => ({ rule_id: r.rule_id, status: r.state, code: lastRevert.get(String(r.rule_id))?.code ?? null }));
  const aborted = scope.some((r) => r.state !== 'reverted' && lastRevert.get(String(r.rule_id))?.status === 'aborted');
  const exitCode = nonReverted.length ? EXIT.report : EXIT.applied;

  // `reverted_at` is what closes the run for apply, so it is stamped only when at least one row
  // actually came back to `current`. A revert that aborted on its first row, or that found nothing
  // to do, changed nothing — closing the run for apply would strand the admin with a receipt they
  // can neither finish applying nor revert. `revert_exit_code` is stamped either way, so the
  // attempt is still on the record.
  const times = revertResults.map((r) => r.at).filter(Boolean).sort();
  receiptText = setFrontmatter(receiptText, {
    reverted_at: counts.reverted > 0 ? (times.length ? times[times.length - 1] : new Date().toISOString()) : undefined,
    revert_exit_code: exitCode,
  });
  writeAtomic(receiptPath, receiptText);

  if (nonReverted.length) {
    process.stderr.write(`apply: ${nonReverted.length} row${nonReverted.length === 1 ? '' : 's'} not reverted: ${nonReverted.map((r) => `${r.rule_id} ${r.status}${r.code ? `(${r.code})` : ''}`).join(', ')}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    run_id: runId,
    phase: 'revert',
    status: nonReverted.length ? 'incomplete' : 'reverted',
    counts,
    non_reverted: nonReverted,
    not_candidates: notCandidates,
    closed_for_apply: counts.reverted > 0,
    invalid: result.invalid,
    aborted,
    receipt: receiptPath,
    results: resultsPath,
    // A revert writes no ledger entry: a reverted rule is re-proposed by the hold rule itself.
    ledger_recorded: 0,
    exit_code: exitCode,
  })}\n`);
  return exitCode;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const runId = basename(runDir);
  if (args.generate) {
    if (args.revert) generateRevert(args, runDir, runId);
    else generate(args, runDir, runId);
    return;
  }
  if (args.row !== null) process.exit(applyRow(args, runDir, runId));
  process.exit(args.revert ? writeReceiptRevert(runDir, runId) : writeReceipt(runDir, runId));
}

main();
