#!/usr/bin/env node
// ledger.mjs — inspect the decisions ledger and release a held rule.
//
// Usage:
//   node ledger.mjs --show [<rule-id> …]
//   node ledger.mjs --reconsider <rule-id> [<rule-id> …]
//
// --show prints the effective (latest) entry per rule. --reconsider appends a `released` entry
// for each rule that has one, which makes the next proposal include the rule again; an id with
// no entry is reported as nothing to release and nothing is written for it. The ledger lives at
// ${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl. Read-only against the workspace.
//
// Exit codes: 0 ok, 1 usage / Node too old.

import { compareRuleIds, requireNode20 } from './lib/calibrate-lib.mjs';
import { appendEntries, latestByRule, ledgerPath, makeEntry, readLedger } from './lib/ledger-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`ledger: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { show: false, reconsider: false, ids: [] };
  for (const a of argv) {
    if (a === '--show') args.show = true;
    else if (a === '--reconsider') args.reconsider = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node ledger.mjs (--show [<rule-id> …] | --reconsider <rule-id> [<rule-id> …])\n');
      process.exit(0);
    } else if (a.startsWith('-')) fail(1, `unknown argument: ${a}`);
    else args.ids.push(a);
  }
  if (args.show === args.reconsider) fail(1, 'pass exactly one of --show, --reconsider');
  if (args.reconsider && !args.ids.length) fail(1, '--reconsider needs at least one rule id');
  return args;
}

// Keep the id numeric when it looks numeric so the ledger matches classification.json.
function normalizeId(id) {
  return /^\d+$/.test(id) ? Number(id) : id;
}

const args = parseArgs(process.argv.slice(2));
const path = ledgerPath();
const latest = latestByRule(readLedger(path));

if (args.show) {
  const keys = (args.ids.length ? args.ids : [...latest.keys()]).sort(compareRuleIds);
  const entries = [];
  const unknown = [];
  for (const key of keys) {
    const entry = latest.get(String(key));
    if (entry) entries.push(entry);
    else unknown.push(normalizeId(String(key)));
  }
  process.stdout.write(`${JSON.stringify({
    ledger_path: path,
    status: 'ok',
    rules: entries.length,
    held_candidates: entries.filter((e) => e.decision !== 'released').length,
    entries,
    no_entry: unknown,
  })}\n`);
} else {
  const released = [];
  const nothing = [];
  const entries = [];
  for (const id of args.ids) {
    const entry = latest.get(String(id));
    if (!entry || entry.decision === 'released') {
      nothing.push(normalizeId(String(id)));
      continue;
    }
    released.push(entry.rule_id);
    // Carry the decision being released so the entry stays traceable to the run that made it.
    entries.push(makeEntry({
      rule_id: entry.rule_id,
      decision: 'released',
      severity_at_decision: entry.severity_at_decision,
      content_hash: entry.content_hash,
      run_id: entry.run_id,
    }));
  }
  appendEntries(entries, path);
  process.stdout.write(`${JSON.stringify({
    ledger_path: path,
    status: released.length ? 'released' : 'nothing_to_release',
    released,
    nothing_to_release: nothing,
  })}\n`);
}
