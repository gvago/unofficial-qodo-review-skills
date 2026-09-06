// proposal-lib.mjs — the proposal row grammar as code: render it, parse it back, and group it
// into sections. Node built-ins only.
//
// Row grammar (references/proposal-format.md is the human-readable copy):
//
//   - [x] <rule_id> · <name> · <current> → <target> · [guard: <terms> ·] <url>
//
// Only the checkbox, the rule id, and the target are decisions. The name in the middle is
// opaque, which is why parsing is right-anchored: an edited or odd name never shifts a field.
// Current is opaque too, so a rule sitting at a severity this skill does not know ("critical")
// renders and parses; the reader compares it against the classification row instead.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compareRuleIds, parseSnapshot, SEVERITIES, TAGS, validateSnapshot } from './calibrate-lib.mjs';

export const TITLE = '# Qodo Standards Calibration — proposal';

// Both severities are \S+ on purpose: an edited "critical" target parses and is reported as an
// invalid override rather than a mangled row, and a rule whose current severity is not one of
// the three (recorded as needs-a-decision) can still be rendered and decided.
export const ROW_RE = /^- \[( |x|X|\?)\] (\d+) · (.+) · (\S+) → (\S+)(?: · guard: ([^·]+))? · (\S+)\s*$/;

export class RunError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

// The exported rule's raw content is what the ledger hashes.
export function hasContent(rule) {
  return Boolean(rule) && typeof rule.content === 'string';
}

// ---------------------------------------------------------------------------------------
// Render

export function ruleUrl(rule, ruleId) {
  const url = rule && typeof rule.url === 'string' ? rule.url.trim() : '';
  return url || `https://app.qodo.ai/rules/${ruleId}`;
}

// A row is one line: a newline anywhere in the name collapses to a single space.
export function oneLine(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ');
}

export function renderRow(row) {
  const guard = Array.isArray(row.guard_hits) && row.guard_hits.length ? ` · guard: ${row.guard_hits.join(', ')}` : '';
  return `- [${row.checked ? 'x' : row.deferred ? '?' : ' '}] ${row.rule_id} · ${oneLine(row.name)} · ${row.current} → ${row.target}${guard} · ${row.url}`;
}

// Sections: one per (direction, tag) pair that has rows — decreases first, then increases,
// taxonomy order within a direction, rows by numeric id — then the needs-a-decision section.
// Pre-checked and deferred rows never share a section.
export function buildSections(displayRows) {
  const byId = (a, b) => compareRuleIds(a.rule_id, b.rule_id);
  const sections = [];
  for (const kind of ['decrease', 'increase']) {
    for (const tag of TAGS) {
      const rows = displayRows.filter((r) => !r.needs_decision && r.direction === kind && r.tag === tag).sort(byId);
      if (rows.length) sections.push({ kind, tag, target: rows[0].target, rows });
    }
  }
  const decisions = displayRows.filter((r) => r.needs_decision).sort(byId);
  if (decisions.length) sections.push({ kind: 'needs_decision', tag: null, target: null, rows: decisions });
  return sections;
}

export function sectionHeading(section) {
  if (section.kind === 'needs_decision') {
    return `## Needs a decision — guard or category conflict (${section.rows.length}) — deferred; check to approve, clear to skip`;
  }
  const label = section.kind === 'decrease' ? 'Decrease' : 'Increase';
  return `## ${label} → ${section.target} · ${section.tag} (${section.rows.length}) — pre-checked; uncheck to skip, [?] to defer`;
}

export function heldFooter(heldCount) {
  return `Held by prior decision: ${heldCount} rules (say "reconsider rule <id>" to release one)`;
}

function blockScalar(text) {
  return String(text ?? '')
    .replace(/\s+$/, '')
    .split(/\r?\n/)
    .map((l) => (l.length ? `  ${l}` : ''))
    .join('\n');
}

export function renderProposal({ run_id, workspace_id, rule_count, proposed, held_by_prior_decision, rubric, sections }) {
  const out = [
    '---',
    `run_id: ${run_id}`,
    `workspace_id: ${workspace_id}`,
    `rule_count: ${rule_count}`,
    `proposed: ${proposed}`,
    `held_by_prior_decision: ${held_by_prior_decision}`,
    'rubric: |',
    blockScalar(rubric),
    '---',
    '',
    TITLE,
    '',
  ];
  for (const section of sections) {
    out.push(sectionHeading(section));
    for (const row of section.rows) out.push(renderRow(row));
    out.push('');
  }
  out.push('---', heldFooter(held_by_prior_decision), '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// Parse

export function parseRow(line, lineNo = null) {
  const m = ROW_RE.exec(line);
  if (!m) return { line: lineNo, raw: line, ok: false, rule_id: null, reason: 'unparseable row' };
  return {
    line: lineNo,
    raw: line,
    ok: true,
    checked: m[1] === 'x' || m[1] === 'X',
    deferred: m[1] === '?',
    rule_id: Number(m[2]),
    middle: m[3],
    current: m[4],
    target: m[5],
    guard_hits: m[6] ? m[6].split(',').map((t) => t.trim()).filter(Boolean) : [],
    url: m[7],
  };
}

// Only these frontmatter keys are numbers; run_id and workspace_id stay strings whatever they
// look like (a run id of all digits must not become a Number).
const NUMERIC_KEYS = Object.freeze(['rule_count', 'proposed', 'held_by_prior_decision']);

// Frontmatter of proposal.md: flat `key: value` lines plus the `rubric: |` block scalar.
// `error` is 'missing' when there is no leading `---` and 'unterminated' when the closing one
// is gone, so the caller can say which instead of reporting a run_id mismatch.
export function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, endLine: 0, error: 'missing' };
  const frontmatter = {};
  let block = null;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '---' && !/^\s/.test(raw)) return { frontmatter, endLine: i + 1, error: null };
    if (block !== null) {
      if (/^\s/.test(raw) || !raw.trim()) {
        frontmatter[block] = `${frontmatter[block]}${raw.replace(/^ {2}/, '')}\n`;
        continue;
      }
      block = null;
    }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    if (m[2].trim() === '|' || m[2].trim() === '|-') {
      block = m[1];
      frontmatter[block] = '';
      continue;
    }
    const value = m[2].trim();
    frontmatter[m[1]] = NUMERIC_KEYS.includes(m[1]) && /^\d+$/.test(value) ? Number(value) : value;
  }
  return { frontmatter, endLine: lines.length, error: 'unterminated' };
}

// Every line that looks like a checklist row, with its 1-based line number. Headings, the
// footer, and prose are ignored; a row whose checkbox is gone is simply not a row (the readback
// reports it as removed).
export function parseProposal(text) {
  const { frontmatter, endLine, error } = parseFrontmatter(text);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = [];
  for (let i = endLine; i < lines.length; i++) {
    const line = lines[i];
    if (!/^- \[/.test(line)) continue;
    rows.push(parseRow(line, i + 1));
  }
  return { frontmatter, rows, error };
}

// ---------------------------------------------------------------------------------------
// Run folder

export function isRendered(row) {
  return Boolean(row.needs_decision) || row.direction !== 'none';
}

// A needs-a-decision row is proposed at the rubric's severity for its tag — the value the veto
// took away. Rows recorded before rubric_proposed existed fall back to the run's snapshot.
export function targetFor(row, snapshot) {
  if (!row.needs_decision) return row.proposed;
  return row.rubric_proposed || snapshot?.severities?.[row.tag] || row.proposed;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new RunError(`${what} ${path} is not valid JSON (${e.message})`);
  }
}

export function listBatches(runDir) {
  const dir = join(runDir, 'batches');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^batch-(\d{3})\.json$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------
// Classification file
//
// classification.jsonl is append-only: one JSON object per line, one line per rule per recording.
// Several recorders (parallel classifier agents) can append to it without coordination, because
// a batch is appended as one write and readers take the LAST line per rule_id. --replace is
// therefore just another append. A legacy classification.json (a JSON array, ≤ 0.4.0) is read
// first when present so an older run folder still resumes.

export const CLASSIFICATION_FILE = 'classification.jsonl';
export const LEGACY_CLASSIFICATION_FILE = 'classification.json';

export function classificationPaths(runDir) {
  return { jsonl: join(runDir, CLASSIFICATION_FILE), legacy: join(runDir, LEGACY_CLASSIFICATION_FILE) };
}

export function isClassificationRow(row) {
  return Boolean(row) && typeof row === 'object' && !Array.isArray(row) && row.rule_id !== undefined && row.rule_id !== null;
}

// Every recorded line in file order (legacy array first), or null when neither file exists.
export function readClassificationLines(runDir, onWarning = () => {}) {
  const { jsonl, legacy } = classificationPaths(runDir);
  if (!existsSync(jsonl) && !existsSync(legacy)) return null;
  const lines = [];
  if (existsSync(legacy)) {
    const rows = readJson(legacy, 'classification file');
    if (!Array.isArray(rows)) throw new RunError(`${legacy} must be a JSON array of rows`);
    for (const row of rows) {
      if (!isClassificationRow(row)) throw new RunError(`${legacy} has an entry that is not a classification row — fix or remove the file and re-record the batches`);
      lines.push(row);
    }
  }
  if (existsSync(jsonl)) {
    const text = readFileSync(jsonl, 'utf8');
    let n = 0;
    for (const raw of text.split(/\r?\n/)) {
      n++;
      if (!raw.trim()) continue;
      let row;
      try { row = JSON.parse(raw); } catch { onWarning(`${jsonl}:${n}: skipping unreadable line`); continue; }
      if (!isClassificationRow(row)) throw new RunError(`${jsonl}:${n} is not a classification row (no rule_id) — fix or remove the line and re-record the batch`);
      lines.push(row);
    }
  }
  return lines;
}

// The effective rows: last line per rule_id wins, ordered by batch then numeric rule id.
export function effectiveRows(lines) {
  const byId = new Map();
  for (const row of lines) byId.set(String(row.rule_id), row);
  return [...byId.values()].sort((a, b) => (a.batch ?? 0) - (b.batch ?? 0) || compareRuleIds(a.rule_id, b.rule_id));
}

export function readClassification(runDir, onWarning) {
  const lines = readClassificationLines(runDir, onWarning);
  return lines === null ? null : effectiveRows(lines);
}

// Everything the proposal and the readback need from a run folder, validated once.
export function loadRun(runDir) {
  const { jsonl } = classificationPaths(runDir);
  const rows = readClassification(runDir, (w) => process.stderr.write(`proposal: ${w}\n`));
  if (rows === null) throw new RunError(`${jsonl} missing — classify the batches first (record-batch.mjs --status)`);

  const snapshotPath = join(runDir, 'rubric-snapshot.yaml');
  if (!existsSync(snapshotPath)) throw new RunError(`${snapshotPath} missing — this run has no pinned rubric`);
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const problems = validateSnapshot(snapshot);
  if (problems.length) throw new RunError(`${snapshotPath} is not a valid rubric snapshot: ${problems.join('; ')}`);
  const rubricText = readFileSync(snapshotPath, 'utf8');

  const exportPath = join(runDir, 'export.json');
  if (!existsSync(exportPath)) throw new RunError(`${exportPath} missing — export the rules first (export-rules.mjs)`);
  const exported = readJson(exportPath, 'export file');
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
    throw new RunError(`${exportPath} must be a JSON object with a rules array — re-run export-rules.mjs`);
  }
  const rules = new Map();
  for (const rule of Array.isArray(exported.rules) ? exported.rules : []) rules.set(String(rule.ruleId), rule);


  const batches = listBatches(runDir);
  const done = [...new Set(rows.map((r) => r.batch))];
  return {
    runDir,
    runId: basename(runDir),
    rows,
    rules,
    snapshot,
    rubricText,
    batches,
    batchesRemaining: batches.filter((b) => !done.includes(b)),
    totalCount: Number.isFinite(exported.totalCount) ? exported.totalCount : rules.size,
  };
}
