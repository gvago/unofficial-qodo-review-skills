// readback-lib.mjs — the one decision parser. Node built-ins only.
//
// Reads the admin's edited checklist back into decisions: `[x]` = approve, `[ ]` = skip,
// `[?]` = defer (no decision, never recorded), an edited target = override, anything else =
// invalid and excluded. Both callers share it so the apply
// step can never disagree with the counts the admin confirmed:
//
//   approve.mjs  readback(runDir)                              — reads proposal.md
//   apply.mjs    readback(runDir, { file: 'receipt.md',
//                                   text: stripStatuses(...) }) — reads the receipt on resume
//
// `text` lets the caller hand over receipt text with its status tokens already stripped, since
// the row grammar is right-anchored on the url and a trailing `· applied` would not parse.
// Every refusal is a RunError with the exit code the CLI should use; nothing here writes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareRuleIds, isSeverity } from './calibrate-lib.mjs';
import { appendEntries, contentHash, isHeld, latestByRule, ledgerPath, makeEntry, readLedger } from './ledger-lib.mjs';
import { hasContent, loadRun, isRendered, parseProposal, RunError, targetFor } from './proposal-lib.mjs';

export function readbackText(counts, invalid) {
  let text = `${counts.approve} approve · ${counts.skip} skip · ${counts.defer} deferred · ${counts.override} override · ${counts.invalid} invalid override`;
  if (invalid.length) {
    const byReason = new Map();
    for (const row of invalid) {
      const key = row.reason;
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(row.line);
    }
    const groups = [...byReason.entries()].map(([reason, lines]) => `rows ${lines.join(', ')}: ${reason}`);
    text += ` (${groups.join('; ')})`;
  }
  return text;
}

// A decision this run recorded is not a prior decision: it must not hold the row out of a
// readback of the same run (a repeated readback after --record-skips, or a resumed apply whose
// approve/override entries --write-receipt has already appended).
function priorDecisions(runId) {
  const own = new Set(['skip', 'approve', 'override']);
  return latestByRule(readLedger(ledgerPath()).filter((e) => !(own.has(e.decision) && String(e.run_id) === runId)));
}

export function readback(runDir, { file = 'proposal.md', text = null } = {}) {
  const run = loadRun(runDir);
  const sourcePath = join(runDir, file);
  if (text === null) {
    if (!existsSync(sourcePath)) {
      const hint = file === 'proposal.md' ? ' — render the proposal first (proposal.mjs --render)' : '';
      throw new RunError(`${sourcePath} missing${hint}`);
    }
    text = readFileSync(sourcePath, 'utf8');
  }
  const parsed = parseProposal(text);
  if (parsed.error === 'missing') throw new RunError(`${sourcePath} has no frontmatter — a proposal starts with the run's \`---\` block. Do not hand-write the file; re-render it with proposal.mjs.`);
  if (parsed.error === 'unterminated') throw new RunError(`${sourcePath} frontmatter is not terminated — the closing \`---\` line is missing. Restore it, or re-render the proposal.`);
  if (String(parsed.frontmatter.run_id ?? '') !== run.runId) {
    throw new RunError(`${sourcePath} frontmatter run_id "${parsed.frontmatter.run_id ?? ''}" does not match the run folder "${run.runId}" — the file belongs to another run.`);
  }

  // What this run rendered: a rubric-proposed change or a needs-a-decision row, minus rows a
  // prior decision holds. A row for anything else (unchanged, held, or invented) is not a
  // decision this run can carry. Rows the admin deleted from the file show up as `removed`.
  const atRender = priorDecisions(run.runId);
  const expected = new Map();
  for (const row of run.rows) {
    const key = String(row.rule_id);
    if (isRendered(row) && !isHeld(row, run.rules.get(key), atRender.get(key))) expected.set(key, row);
  }

  const seen = new Map();
  for (const row of parsed.rows) if (row.rule_id !== null) seen.set(String(row.rule_id), (seen.get(String(row.rule_id)) ?? 0) + 1);

  const rows = [];
  const invalid = [];
  for (const parsedRow of parsed.rows) {
    const key = String(parsedRow.rule_id);
    const add = (reason) => invalid.push({ line: parsedRow.line, rule_id: parsedRow.rule_id, reason, raw: parsedRow.raw });
    if (!parsedRow.ok) {
      add(parsedRow.reason);
      continue;
    }
    const row = expected.get(key);
    if (!row) {
      add(`rule ${parsedRow.rule_id} was not proposed in this run`);
      continue;
    }
    if (seen.get(key) > 1) {
      add(`duplicate rule id ${parsedRow.rule_id}`);
      continue;
    }
    // The current severity is display-only, so an edit to it means the row no longer describes
    // the rule it names: report it instead of deciding from a changed premise.
    if (String(parsedRow.current) !== String(row.current)) {
      add('current severity was edited');
      continue;
    }
    const rendered = targetFor(row, run.snapshot);
    const entry = { line: parsedRow.line, rule_id: row.rule_id, current: row.current, target: parsedRow.target, rendered_target: rendered, tag: row.tag };
    // `[?]` defers: no decision, nothing recorded, proposed again next run. `[ ]` is a skip.
    if (parsedRow.deferred) {
      rows.push({ ...entry, decision: 'defer', target: rendered });
      continue;
    }
    if (!parsedRow.checked) {
      rows.push({ ...entry, decision: 'skip', target: rendered });
      continue;
    }
    if (!isSeverity(parsedRow.target)) {
      add(`"${parsedRow.target}" is not a severity`);
      continue;
    }
    if (parsedRow.target === row.current) {
      add(`"${parsedRow.target}" equals current severity`);
      continue;
    }
    rows.push({ ...entry, decision: parsedRow.target === rendered ? 'approve' : 'override' });
  }

  const removedIds = [...expected.values()].filter((row) => !seen.has(String(row.rule_id))).map((row) => row.rule_id).sort(compareRuleIds);
  const counts = {
    approve: rows.filter((r) => r.decision === 'approve').length,
    skip: rows.filter((r) => r.decision === 'skip').length,
    defer: rows.filter((r) => r.decision === 'defer').length,
    override: rows.filter((r) => r.decision === 'override').length,
    invalid: invalid.length,
    removed: removedIds.length,
  };
  return {
    run,
    sourcePath,
    proposalPath: sourcePath,
    frontmatter: parsed.frontmatter,
    parsedRows: parsed.rows,
    rows,
    invalid,
    counts,
    removedIds,
    expected: expected.size,
    readback_text: readbackText(counts, invalid),
  };
}

// Appends the readback's skip rows to the decisions ledger. Recording is per (run, rule), not per
// run: a rule this run already skipped is left alone, so recording again after the admin unchecks
// another row appends only that row, and an unchanged file appends nothing. Both `approve.mjs
// --record-skips` and `apply.mjs --generate` call this, so the skips are on record before the
// first write whichever order the agent used.
export function recordSkips(result, path = ledgerPath()) {
  const latest = latestByRule(readLedger(path));
  const warnings = [];
  const already = [];
  const entries = [];
  for (const r of result.rows.filter((row) => row.decision === 'skip')) {
    const prior = latest.get(String(r.rule_id));
    if (prior && prior.decision === 'skip' && String(prior.run_id) === result.run.runId) {
      already.push(r.rule_id);
      continue;
    }
    const rule = result.run.rules.get(String(r.rule_id));
    if (!hasContent(rule)) warnings.push(`rule ${r.rule_id} has no exported content — recorded without a content hash, so it will be proposed again`);
    entries.push(makeEntry({
      rule_id: r.rule_id,
      decision: 'skip',
      severity_at_decision: r.current,
      content_hash: hasContent(rule) ? contentHash(rule.content) : null,
      run_id: result.run.runId,
    }));
  }
  appendEntries(entries, path);
  return {
    ledger_path: path,
    status: entries.length ? 'recorded' : already.length ? 'already_recorded' : 'nothing_to_record',
    recorded: entries.length,
    rule_ids: entries.map((e) => e.rule_id),
    already_recorded: already,
    warnings,
  };
}
