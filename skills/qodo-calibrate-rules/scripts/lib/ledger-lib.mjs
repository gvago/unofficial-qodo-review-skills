// ledger-lib.mjs — the decisions ledger. Node built-ins only.
//
// The ledger is a JSON-lines file at ${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl.
// One object per line, appended, never rewritten:
//
//   {rule_id, decision, severity_at_decision, content_hash, run_id, decided_at}
//
// decision ∈ approve | skip | override | released. The latest entry for a rule wins.
// This module is the single place the hold rule lives, so the proposal, the approval step, and
// the apply step all answer "has the admin already decided this rule?" the same way.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DECISIONS = Object.freeze(['approve', 'skip', 'override', 'released']);

export function qodoHome() {
  return process.env.QODO_HOME || join(homedir(), '.qodo');
}

export function ledgerPath() {
  return join(qodoHome(), 'calibrate', 'decisions.jsonl');
}

// sha256 of the rule's raw content, exactly as the export stored it.
export function contentHash(content) {
  return `sha256:${createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex')}`;
}

export function makeEntry({ rule_id, decision, severity_at_decision, content_hash, run_id, decided_at }) {
  return {
    rule_id,
    decision,
    severity_at_decision: severity_at_decision ?? null,
    content_hash: content_hash ?? null,
    run_id: run_id ?? null,
    decided_at: decided_at ?? new Date().toISOString(),
  };
}

// A corrupt or blank line never stops a run: it is warned about and skipped, so a half-written
// line from a killed process cannot lock the admin out of their own decisions.
export function readLedger(path = ledgerPath(), warn = (m) => process.stderr.write(m)) {
  if (!existsSync(path)) return [];
  const entries = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      warn(`ledger: ${path}:${i + 1}: skipping unreadable line\n`);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.rule_id === undefined || entry.rule_id === null || !DECISIONS.includes(entry.decision)) {
      warn(`ledger: ${path}:${i + 1}: skipping line without a rule_id and a known decision\n`);
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

// File order is append order, so the last entry for a rule is the effective one.
export function latestByRule(entries) {
  const latest = new Map();
  for (const entry of entries) latest.set(String(entry.rule_id), entry);
  return latest;
}

export function appendEntries(entries, path = ledgerPath()) {
  if (!entries.length) return 0;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return entries.length;
}

// Is this rule held out of the proposal by a prior decision?
//   skip / override — held while the rule's content is byte-identical to the decided content.
//   approve         — held while the rule still sits at the severity the admin approved.
//   released        — never holds.
// `rule` is the exported rule (for its raw content); without it a skip/override cannot be
// verified, so the row is proposed again rather than silently held.
export function isHeld(row, rule, entry) {
  if (!entry) return false;
  switch (entry.decision) {
    case 'released':
      return false;
    case 'skip':
    case 'override': {
      if (!rule || typeof rule.content !== 'string') return false;
      return entry.content_hash === contentHash(rule.content);
    }
    case 'approve': {
      // Both sides must actually name a severity: two blanks are not a match.
      const current = String(row?.current ?? '').trim();
      const decided = String(entry.severity_at_decision ?? '').trim();
      return Boolean(current) && Boolean(decided) && current === decided;
    }
    default:
      return false;
  }
}
