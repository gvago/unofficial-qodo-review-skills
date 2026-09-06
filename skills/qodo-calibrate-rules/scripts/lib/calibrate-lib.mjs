// calibrate-lib.mjs — shared helpers for the calibration scripts. Node built-ins only.
// This module is the single code encoding of the rubric taxonomy, default severities, and
// default guard terms (references/rubric.md is the human-readable copy).

export const MIN_NODE_MAJOR = 20;

export function requireNode20() {
  const major = Number(String(process.versions.node).split('.')[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    process.stderr.write(`This script needs Node.js ${MIN_NODE_MAJOR} or newer; found ${process.versions.node}. Install a current Node.js and retry.\n`);
    process.exit(1);
  }
}

// Layer 1 of references/rubric.md — the fixed taxonomy and its default severities.
export const TAG_DEFAULTS = Object.freeze({
  documentation: 'recommendation',
  naming: 'recommendation',
  'style-formatting': 'recommendation',
  'import-order': 'recommendation',
  'test-hygiene': 'warning',
  'error-handling': 'warning',
  logging: 'warning',
  'api-contract': 'warning',
  architecture: 'warning',
  'correctness-contract': 'error',
  'security-control': 'error',
  'data-integrity': 'error',
  'secrets-handling': 'error',
});
export const TAGS = Object.freeze(Object.keys(TAG_DEFAULTS));
export const SEVERITIES = Object.freeze(['error', 'warning', 'recommendation']);
export const RANK = Object.freeze({ recommendation: 1, warning: 2, error: 3 });
export const PRIOR_CATEGORIES = Object.freeze(['security', 'compliance']);

// Layer 3 of references/rubric.md — default guard terms.
export const DEFAULT_GUARD_TERMS = Object.freeze([
  'auth', 'authoriz', 'authentic', 'secret', 'token', 'credential', 'password', 'PII',
  'personal data', 'payment', 'migration', 'delete', 'deletion', 'drop', 'encrypt', 'decrypt',
]);
// Stem exceptions: "auth" must not match the word "author" (authors, authored, authoring,
// authorship) while still matching authorization/authority.
const STEM_EXCEPTIONS = Object.freeze({ auth: 'auth(?!or(?:s|ed|ing|ship)?\\b)' });

export function isSeverity(value) {
  return SEVERITIES.includes(value);
}

export function isTag(value) {
  return Object.hasOwn(TAG_DEFAULTS, value);
}

export function compareRuleIds(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// Case-insensitive stem match: the term must start at a word boundary and may continue
// ("auth" hits "authorization", "delete" hits "deleted"). Multi-word terms match as a phrase
// across any whitespace. Stem matching can over-match (dropdown, tokenizer); a false hit only
// adds a needs_decision row, never a change.
export function buildGuardMatchers(terms) {
  return terms.map((term) => {
    const key = term.toLowerCase();
    const body = Object.hasOwn(STEM_EXCEPTIONS, key)
      ? STEM_EXCEPTIONS[key]
      : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return { term, re: new RegExp(`\\b${body}`, 'i') };
  });
}

export function guardHits(rule, matchers) {
  const haystack = `${rule.name ?? ''}\n${rule.content ?? ''}`;
  return matchers.filter((m) => m.re.test(haystack)).map((m) => m.term);
}

// ---------------------------------------------------------------------------------------
// rubric.yaml — a fixed YAML subset parsed without a library.

export class RubricError extends Error {
  constructor(message, { path = 'rubric.yaml', line = null, text = null, hint = null } = {}) {
    super(message);
    this.name = 'RubricError';
    this.path = path;
    this.line = line;
    this.text = text;
    this.hint = hint;
  }

  format() {
    const where = this.line ? `${this.path}:${this.line}` : this.path;
    let out = `rubric: ${where}: ${this.message}\n`;
    if (this.text !== null) out += `  > ${this.text}\n`;
    if (this.hint) out += `  ${this.hint}\n`;
    return out;
  }
}

const TOP_LEVEL_KEYS = Object.freeze(['version', 'severity_overrides', 'guard_terms_extra']);
const VALID_TAGS_HINT = `valid tags: ${TAGS.join(', ')}`;
const VALID_SEVERITIES_HINT = `valid severities: ${SEVERITIES.join(', ')}`;
const TOP_KEYS_HINT = `top-level keys: ${TOP_LEVEL_KEYS.join(', ')}`;

export function stripComment(line) {
  // Remove a trailing " # comment" outside quotes; a line starting with # is a comment.
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      break;
    } else out += c;
  }
  return out.replace(/\s+$/, '');
}

export function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

function quoteCount(s) {
  return (s.match(/["']/g) || []).length;
}

function splitFlow(inner, lineNo, raw, path) {
  const items = inner.split(',');
  for (const item of items) {
    if (quoteCount(item) % 2 === 1) {
      throw new RubricError('a quoted item containing a comma is not supported in a flow list', {
        path, line: lineNo, text: raw, hint: 'use a block list instead:\n    guard_terms_extra:\n      - "term, with comma"',
      });
    }
  }
  return items;
}

export function parseRubric(rawText, path = 'rubric.yaml') {
  const text = rawText.replace(/^﻿/, '');
  const rubric = { version: null, severity_overrides: {}, guard_terms_extra: [] };
  const seenKeys = new Set();
  const seenTags = new Set();
  const lines = text.split(/\r?\n/);
  let section = null; // 'severity_overrides' | 'guard_terms_extra' | null

  const setOverride = (tagRaw, sevRaw, lineNo, raw) => {
    const tag = unquote(tagRaw);
    const sev = unquote(sevRaw);
    if (!isTag(tag)) throw new RubricError(`unknown tag "${tag}" in severity_overrides`, { path, line: lineNo, text: raw, hint: VALID_TAGS_HINT });
    if (seenTags.has(tag)) throw new RubricError(`tag "${tag}" appears twice in severity_overrides`, { path, line: lineNo, text: raw });
    if (!isSeverity(sev)) throw new RubricError(`invalid severity "${sev}" for tag "${tag}"`, { path, line: lineNo, text: raw, hint: VALID_SEVERITIES_HINT });
    seenTags.add(tag);
    rubric.severity_overrides[tag] = sev;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineNo = idx + 1;
    const line = stripComment(raw);
    if (!line.trim()) continue;
    if (line === '---' || line === '...') continue;

    if (/^\s/.test(line)) {
      const body = line.trim();
      if (section === 'severity_overrides') {
        const m = body.match(/^([^:]+):\s*(.*)$/);
        if (!m) throw new RubricError('expected "<tag>: <severity>" under severity_overrides', { path, line: lineNo, text: raw, hint: VALID_TAGS_HINT });
        setOverride(m[1], m[2], lineNo, raw);
      } else if (section === 'guard_terms_extra') {
        const m = body.match(/^-\s*(.*)$/);
        if (!m) throw new RubricError('expected "- <term>" under guard_terms_extra', { path, line: lineNo, text: raw });
        const term = unquote(m[1]);
        if (!term) throw new RubricError('empty guard term', { path, line: lineNo, text: raw });
        rubric.guard_terms_extra.push(term);
      } else {
        throw new RubricError('unexpected indented line', { path, line: lineNo, text: raw, hint: TOP_KEYS_HINT });
      }
      continue;
    }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) throw new RubricError('expected "<key>: <value>"', { path, line: lineNo, text: raw, hint: TOP_KEYS_HINT });
    const key = m[1];
    const value = m[2].trim();
    if (!TOP_LEVEL_KEYS.includes(key)) throw new RubricError(`unknown key "${key}"`, { path, line: lineNo, text: raw, hint: TOP_KEYS_HINT });
    if (seenKeys.has(key)) throw new RubricError(`duplicate key "${key}"`, { path, line: lineNo, text: raw });
    seenKeys.add(key);
    section = null;

    if (key === 'version') {
      if (unquote(value) !== '1') throw new RubricError(`unsupported version "${value}"`, { path, line: lineNo, text: raw, hint: 'this skill understands version: 1' });
      rubric.version = 1;
    } else if (key === 'severity_overrides') {
      if (value === '') section = 'severity_overrides';
      else if (value === '{}') { /* empty */ }
      else if (value.startsWith('{') && value.endsWith('}')) {
        for (const pair of splitFlow(value.slice(1, -1), lineNo, raw, path)) {
          if (!pair.trim()) continue;
          const pm = pair.match(/^\s*([^:]+):\s*(.*)$/);
          if (!pm) throw new RubricError('expected "{tag: severity, ...}"', { path, line: lineNo, text: raw, hint: VALID_TAGS_HINT });
          setOverride(pm[1], pm[2], lineNo, raw);
        }
      } else throw new RubricError('severity_overrides must be a mapping of tag → severity', { path, line: lineNo, text: raw, hint: VALID_TAGS_HINT });
    } else if (key === 'guard_terms_extra') {
      if (value === '') section = 'guard_terms_extra';
      else if (value === '[]') { /* empty */ }
      else if (value.startsWith('[') && value.endsWith(']')) {
        for (const item of splitFlow(value.slice(1, -1), lineNo, raw, path)) {
          const term = unquote(item);
          if (term) rubric.guard_terms_extra.push(term);
        }
      } else throw new RubricError('guard_terms_extra must be a list of terms', { path, line: lineNo, text: raw });
    }
  }

  if (rubric.version !== 1) throw new RubricError('missing "version: 1"', { path });
  return rubric;
}

export function mergeRubric(rubric) {
  const severities = { ...TAG_DEFAULTS, ...rubric.severity_overrides };
  const guard_terms = [...DEFAULT_GUARD_TERMS];
  for (const t of rubric.guard_terms_extra) {
    if (!guard_terms.some((g) => g.toLowerCase() === t.toLowerCase())) guard_terms.push(t);
  }
  return { severities, guard_terms };
}

export function renderSnapshot(effective, rubricPath, overrides, now = new Date()) {
  const applied = Object.keys(overrides);
  const lines = [
    `# Effective calibration rubric — defaults from references/rubric.md merged with ${rubricPath}`,
    `# Written ${now.toISOString()}. Overrides applied: ${applied.length ? applied.join(', ') : 'none'}.`,
    'version: 1',
    'severities:',
    ...Object.entries(effective.severities).map(([tag, sev]) => `  ${tag}: ${sev}`),
    'guard_terms:',
    ...effective.guard_terms.map((t) => `  - ${JSON.stringify(t)}`),
  ];
  return `${lines.join('\n')}\n`;
}

// Reads a snapshot written by renderSnapshot.
export function parseSnapshot(text) {
  const severities = {};
  const guard_terms = [];
  let section = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      section = line.startsWith('severities:') ? 'severities' : line.startsWith('guard_terms:') ? 'guard_terms' : null;
      continue;
    }
    const body = line.trim();
    if (section === 'severities') {
      const m = body.match(/^([^:]+):\s*(.*)$/);
      if (m) severities[unquote(m[1])] = unquote(m[2]);
    } else if (section === 'guard_terms') {
      const m = body.match(/^-\s*(.*)$/);
      if (m) guard_terms.push(unquote(m[1]));
    }
  }
  return { severities, guard_terms };
}

export function validateSnapshot(effective) {
  const problems = [];
  for (const tag of TAGS) {
    if (!Object.hasOwn(effective.severities, tag) || !isSeverity(effective.severities[tag])) problems.push(`no valid severity for tag "${tag}"`);
  }
  if (!effective.guard_terms.length) problems.push('guard_terms is empty');
  return problems;
}
