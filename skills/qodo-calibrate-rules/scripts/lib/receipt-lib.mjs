// receipt-lib.mjs — the receipt grammar and the generated apply script, as code.
// Node built-ins only. references/receipt-format.md is the human-readable copy.
//
// A receipt row is a proposal row plus status tokens appended after the url:
//
//   - [x] 101 · … · error → recommendation · https://… · failed(MT-VALIDATION) · applied
//
// Tokens accumulate left to right and the last one is the effective status; a row with no token
// is pending. `proposal.md` is never modified — the receipt is a separate file that starts as a
// copy of it. Because the row grammar is right-anchored on the url, every token must be stripped
// before a row parses, which is what splitStatus / stripStatuses are for.
//
// Stripping is right-anchored too: only the unbroken run of tokens at the end of the line is
// removed, so a rule whose name happens to be exactly `deferred` or
// `applied` survives intact.

import { readFileSync } from 'node:fs';
import { parseFrontmatter, parseRow } from './proposal-lib.mjs';

export const SKILL_VERSION = '0.8.0';
export const RECEIPT_FILE = 'receipt.md';
export const RESULTS_FILE = 'apply-results.jsonl';
export const SCRIPT_FILE = 'apply.sh';
export const REVERT_SCRIPT_FILE = 'revert.sh';
export const DEFAULT_UPDATE_ARGS = 'rules update';

// Per-row exit codes are the loop's control channel.
export const EXIT = Object.freeze({ applied: 0, failed: 10, deferred: 20, abort: 30, usage: 1, refused: 2, report: 3 });

// Every token the receipt can carry, apply and verify/revert alike: a verify-phase `· verified` must
// still strip cleanly here so the row grammar keeps parsing. The pattern matches the whole
// trailing run of tokens at once, anchored to end of line, so a mid-row field that reads like a
// token is never mistaken for one.
export const STATUS_TOKEN = '(?: · (?:applied|failed\\([^)]*\\)|deferred|skipped|verified|mismatch\\([^)]*\\)|reverted))';
export const STATUS_RE = new RegExp(`(${STATUS_TOKEN}+)[ \\t]*$`);

// The verify class: written by verify.mjs, and skipped when the apply state is read back. Every
// other token is an apply-class token.
const VERIFY_TOKEN_RE = /^(?:verified|mismatch\([^)]*\))$/;

// The revert class: tokens only a revert writes. The apply report ignores these, because they say
// what happened *after* the apply, not what the apply did.
const REVERT_TOKEN_RE = /^(?:reverted|failed\(revert:[^)]*\))$/;

// A severity is only allowed inside a `mismatch(…)` token if it cannot break the token grammar:
// a `)` would end the token early and a ` · ` or a newline would look like a token boundary, so
// STATUS_RE would stop matching the row and the whole receipt would stop parsing. Anything the
// platform hands back that is not a plain word becomes `unknown` — the row still says the
// workspace disagreed, which is the part that matters.
const SEVERITY_WORD_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

export function severityWord(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text && SEVERITY_WORD_RE.test(text) ? text : 'unknown';
}

// Result statuses that folding turns into a token. `aborted` and `retrying` are recorded for the
// audit trail but leave the row pending — an abort-class error must not mark the row.
//
// A revert-phase result is tokenised differently on purpose: a revert that did not take means the
// rule is *still at the apply target*, so it must not read as a plain `failed(<code>)` (which
// would make the apply state `failed` and flip the expected severity). `failed(revert:<code>)`
// stays inside the `failed(…)` grammar, keeps the apply state `applied`, and is therefore picked
// up again by the next `--generate --revert`. An exhausted rate-limit retry folds the same way.
const TOKEN_FOR = Object.freeze({
  applied: () => 'applied',
  failed: (r) => (r.phase === 'revert' ? `failed(revert:${r.code || 'unknown'})` : `failed(${r.code || 'unknown'})`),
  deferred: (r) => (r.phase === 'revert' ? `failed(revert:${r.code || 'unknown'})` : 'deferred'),
  verified: () => 'verified',
  mismatch: (r) => `mismatch(${severityWord(r.actual)})`,
  reverted: () => 'reverted',
});

export function statusToken(result) {
  const make = TOKEN_FOR[String(result?.status ?? '')];
  return make ? make(result ?? {}) : null;
}

// Every status token, as a list, whatever the caller had at hand.
function tokenList(statuses) {
  return typeof statuses === 'string' ? splitStatus(statuses).statuses : (statuses ?? []);
}

// The row's last apply-class token, verbatim (`applied`, `failed(MT-VALIDATION)`,
// `failed(revert:…)`, `deferred`, `skipped`, `reverted`), or null when the row is pending.
export function applyToken(statuses) {
  const list = tokenList(statuses);
  for (let i = list.length - 1; i >= 0; i--) if (!VERIFY_TOKEN_RE.test(list[i])) return list[i];
  return null;
}

// The row's apply state: what the loop did, with `failed(<code>)` collapsed to `failed` and the
// one twist that `failed(revert:<code>)` reads as `applied` — the revert did not take, so the rule
// is still sitting at the apply target. Verify expects `target` for `applied` and `current` for
// everything else.
export function applyState(statuses) {
  const token = applyToken(statuses);
  if (token === null) return 'pending';
  if (token.startsWith('failed(revert:')) return 'applied';
  if (token.startsWith('failed(')) return 'failed';
  return token;
}

// The apply state the *apply* report reads: the last token that is neither verify-class nor
// revert-class. A row the apply wrote and a later revert failed to undo (`failed(revert:…)`) or
// did undo (`reverted`) was still applied by this loop, and the apply report is a record of that
// loop — the revert has its own report. Keeping the two views apart is why this is a separate
// function from `applyState`, which answers "where is the rule now?".
export function applyPhaseState(statuses) {
  const list = tokenList(statuses);
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (VERIFY_TOKEN_RE.test(t) || REVERT_TOKEN_RE.test(t)) continue;
    return t.startsWith('failed(') ? 'failed' : t;
  }
  return 'pending';
}

// The row's last verify-class token (`verified`, `mismatch(<actual>)`), or null when the row has
// never been read back.
export function verifyState(statuses) {
  const list = tokenList(statuses);
  for (let i = list.length - 1; i >= 0; i--) if (VERIFY_TOKEN_RE.test(list[i])) return list[i];
  return null;
}

// The severity a `mismatch(<actual>)` token reports, or null for anything else.
export function mismatchActual(token) {
  const m = /^mismatch\(([^)]*)\)$/.exec(String(token ?? ''));
  return m ? m[1] : null;
}

// Does the receipt say this row's rule is believed to sit at something other than `current`?
// That is what revert has to undo:
//   - apply state `applied` — the loop wrote `target` (a `failed(revert:…)` row included: the
//     revert did not take, so it is still at `target` and must be re-sent), or
//   - the last verify token is `mismatch(<actual>)` with an actual that is not `current`
//     (nothing to undo).
// Two states are never candidates: a row already `reverted` (which is what makes a revert
// resumable) and a row whose last verify token is `mismatch(missing)` — the rule is gone from the
// active set, so there is nothing to write a severity to and an update would only fail with a
// not-found code.
export function isRevertCandidate(row) {
  const statuses = row?.statuses ?? [];
  const state = applyState(statuses);
  if (state === 'reverted') return false;
  const actual = mismatchActual(verifyState(statuses));
  if (actual === 'missing') return false;
  if (state === 'applied') return true;
  if (actual === null) return false;
  return String(actual).toLowerCase() !== String(row?.current ?? '').toLowerCase();
}

// { row, statuses, eol } — the line without its trailing tokens, the tokens in file order, and
// any carriage return the line ended with so a CRLF receipt round-trips.
export function splitStatus(line) {
  const text = String(line);
  const cr = text.endsWith('\r') ? '\r' : '';
  const body = cr ? text.slice(0, -1) : text;
  const m = STATUS_RE.exec(body);
  if (!m) return { row: body + cr, statuses: [], eol: cr };
  const statuses = m[1].split(' · ').filter(Boolean);
  return { row: body.slice(0, m.index) + cr, statuses, eol: cr };
}

// Appends a token to a row line, before any carriage return.
function appendToken(line, token) {
  const text = String(line);
  return text.endsWith('\r') ? `${text.slice(0, -1)} · ${token}\r` : `${text} · ${token}`;
}

export function effectiveStatus(statuses) {
  const list = typeof statuses === 'string' ? splitStatus(statuses).statuses : (statuses ?? []);
  return list.length ? list[list.length - 1] : 'pending';
}

export function isRowLine(line) {
  return /^- \[/.test(line);
}

// Receipt text with every status token removed: exactly what the row grammar (and therefore the
// readback) expects to see.
export function stripStatuses(text) {
  return String(text)
    .split('\n')
    .map((line) => (isRowLine(line) ? splitStatus(line).row : line))
    .join('\n');
}

// The row's own text, without tokens and without a trailing carriage return: what parseRow wants.
function rowBody(line) {
  const { row } = splitStatus(line);
  return row.endsWith('\r') ? row.slice(0, -1) : row;
}

// Frontmatter plus one entry per row: the parsed row (from the stripped line), the raw line, its
// tokens, and the effective status.
export function parseReceipt(text) {
  const { frontmatter, endLine, error } = parseFrontmatter(text);
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = [];
  for (let i = endLine; i < lines.length; i++) {
    const line = lines[i];
    if (!isRowLine(line)) continue;
    const { statuses } = splitStatus(line);
    const body = rowBody(line);
    rows.push({
      ...parseRow(body, i + 1),
      raw: line,
      stripped: body,
      statuses,
      status: effectiveStatus(statuses),
      apply_state: applyState(statuses),
      apply_token: applyToken(statuses),
      verify_state: verifyState(statuses),
    });
  }
  return { frontmatter, rows, error };
}

// A corrupt or half-written line never stops a run: the append-only results file can be cut off
// mid-line by a kill, and the rest of it is still the record of what happened.
export function readResults(path, warn = (m) => process.stderr.write(m)) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const results = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      warn(`apply: ${path}:${i + 1}: skipping unreadable result line\n`);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.rule_id === undefined || entry.rule_id === null) {
      warn(`apply: ${path}:${i + 1}: skipping result line without a rule_id\n`);
      continue;
    }
    results.push(entry);
  }
  return results;
}

export function lastResultByRule(results) {
  const last = new Map();
  for (const r of results) last.set(String(r.rule_id), r);
  return last;
}

// Folds the results file into the receipt: a row whose last result names a different status than
// the row's effective status gains that token. Idempotent — folding twice appends nothing the
// second time, which is what makes a crash between the results append and the receipt rewrite
// recoverable by the next --generate or --write-receipt.
export function foldResults(receiptText, results) {
  const last = lastResultByRule(results);
  let changed = 0;
  const out = String(receiptText).split('\n').map((line) => {
    if (!isRowLine(line)) return line;
    const { statuses } = splitStatus(line);
    const parsed = parseRow(rowBody(line));
    if (!parsed.ok) return line;
    const result = last.get(String(parsed.rule_id));
    if (!result) return line;
    const token = statusToken(result);
    if (!token || token === effectiveStatus(statuses)) return line;
    changed++;
    return appendToken(line, token);
  }).join('\n');
  return { text: out, changed };
}

// Appends `· <token>` to rows the predicate selects and that carry no token yet. Used for the
// `· skipped` tokens the generator writes for unchecked rows.
export function markRows(receiptText, ruleIds, token) {
  const wanted = new Set([...ruleIds].map(String));
  let changed = 0;
  const out = String(receiptText).split('\n').map((line) => {
    if (!isRowLine(line)) return line;
    const { statuses } = splitStatus(line);
    const parsed = parseRow(rowBody(line));
    if (!parsed.ok || !wanted.has(String(parsed.rule_id)) || statuses.length) return line;
    changed++;
    return appendToken(line, token);
  }).join('\n');
  return { text: out, changed };
}

// Sets or replaces flat frontmatter keys. New keys land immediately before the `rubric: |` block
// (whose indented lines run to the closing `---`), so the block scalar is never broken.
export function setFrontmatter(text, values) {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return String(text);
  const lines = String(text).split('\n');
  if (lines[0]?.replace(/^\uFEFF/, '').trim() !== '---') throw new Error('receipt has no frontmatter to update');
  let close = -1;
  let rubric = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' && !/^\s/.test(lines[i])) { close = i; break; }
    if (rubric < 0 && /^rubric:\s*\|/.test(lines[i])) rubric = i;
  }
  if (close < 0) throw new Error('receipt frontmatter is not terminated');
  const pending = [];
  for (const [key, value] of entries) {
    const re = new RegExp(`^${key}:`);
    let found = -1;
    for (let i = 1; i < close; i++) if (re.test(lines[i])) { found = i; break; }
    if (found >= 0) lines[found] = `${key}: ${value}`;
    else pending.push(`${key}: ${value}`);
  }
  if (pending.length) lines.splice(rubric >= 0 ? rubric : close, 0, ...pending);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// The generated apply script

// POSIX double-quoted form: `\`, `"`, `$` and a backtick are the only characters that keep a
// meaning inside double quotes.
export function shq(value) {
  return `"${String(value).replace(/([\\"$`])/g, '\\$1')}"`;
}

// Revert's key is deliberately *not* the apply key. `--idempotency-key` semantics are server-side
// and unverified: a server that replayed the cached response for `calibrate-<run>-<id>` would
// answer a revert with the apply's result and the revert would look like it worked.
export function idempotencyKey(runId, ruleId, mode = 'apply') {
  return mode === 'revert' ? `calibrate-revert-${runId}-${ruleId}` : `calibrate-${runId}-${ruleId}`;
}

// The exact argv `--row` hands the launcher, and the comment the script carries per row.
export function updateArgv({ updateArgs, ruleId, target, runId, mode = 'apply' }) {
  return [...updateArgs, '--rule-id', String(ruleId), '--severity', target, '--json', '--idempotency-key', idempotencyKey(runId, ruleId, mode)];
}

// The exit codes that stop the loop. 30 is the abort class proper; 1 (usage / Node too old),
// 2 (refused: no receipt, a run_id from another run, a stale script), 126 (not executable),
// 127 (interpreter not found) and anything above 128 (killed by a signal) all mean `--row` cannot
// run at all, so attempting the remaining rows would only repeat the same failure and would leave
// the final --write-receipt to fail too — the agent would get no report.
export const STOP_CODES = Object.freeze([EXIT.abort, EXIT.usage, EXIT.refused, 126, 127]);

// One row per approve/override decision, in file order. `set -e` is deliberately absent: a
// failed or deferred row must not stop the loop. A stopping row sets ABORTED, after which every
// later `row` returns without calling anything; the script still ends in --write-receipt, so the
// agent always gets the report (exit 3, `aborted: true`) and never a bare exit code.
//
// `node` is embedded as the absolute interpreter path (`process.execPath`), not the bare word: a
// non-interactive `sh` can have a minimal PATH — exactly the environment a GUI-launched agent
// runs in — and a `node: not found` for every row would otherwise look like a workspace failure.
// `mode: 'revert'` changes four things and nothing else: the header word, `--revert` on each row
// call, `--revert` on the final `--write-receipt`, and the per-row comment's idempotency key. The
// `row` function, ABORTED, STOP_CODES, and the absent `set -e` are byte-identical, because the
// revert loop *is* the apply loop with a different target column.
export function renderApplyScript({ runDir, scriptsDir, launcher, updateArgs = DEFAULT_UPDATE_ARGS, runId, rows, mode = 'apply', node = process.execPath, now = new Date() }) {
  const applyPath = `${scriptsDir}/apply.mjs`;
  const reverting = mode === 'revert';
  const flag = reverting ? ' --revert' : '';
  const tail = updateArgs.trim() === DEFAULT_UPDATE_ARGS ? '' : ` --update-args ${shq(updateArgs.trim())}`;
  const stop = STOP_CODES.join('|');
  const out = [
    '#!/bin/sh',
    `# qodo-calibrate-rules ${SKILL_VERSION} · run ${runId}${reverting ? ' · revert' : ''} · ${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${now.toISOString()} · do not edit`,
    `# One Bash invocation ${reverting ? 'reverts' : 'applies'} the whole batch: sh ${reverting ? REVERT_SCRIPT_FILE : SCRIPT_FILE}. Never run the rows by hand.`,
    'set -u',
    'ABORTED=0',
    `row() { [ "$ABORTED" -eq 1 ] && return 0; ${shq(node)} ${shq(applyPath)} --run ${shq(runDir)} --qodo ${shq(launcher)}${tail} --row "$1" --target "$2"${flag}; rc=$?; case "$rc" in ${stop}) ABORTED=1 ;; *) if [ "$rc" -gt 128 ]; then ABORTED=1; fi ;; esac; return 0; }`,
  ];
  const words = updateArgs.trim().split(/\s+/).filter(Boolean);
  for (const row of rows) {
    const argv = updateArgv({ updateArgs: words, ruleId: row.rule_id, target: row.target, runId, mode });
    out.push(`row ${row.rule_id} ${row.target}    # qodo ${argv.join(' ')}`);
  }
  out.push(`exec ${shq(node)} ${shq(applyPath)} --run ${shq(runDir)} --write-receipt${flag}`, '');
  return out.join('\n');
}
