import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReceipt, REVERT_SCRIPT_FILE } from '../lib/receipt-lib.mjs';
import { readClassification, readClassificationLines } from '../lib/proposal-lib.mjs';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = join(TEST_DIR, '..');
export const SKILL_DIR = join(SCRIPTS_DIR, '..');
export const FAKE_QODO = join(TEST_DIR, 'fake-qodo.mjs');
export const EXPORT = join(SCRIPTS_DIR, 'export-rules.mjs');
export const RUBRIC = join(SCRIPTS_DIR, 'rubric.mjs');
export const RECORD = join(SCRIPTS_DIR, 'record-batch.mjs');
export const PROPOSAL = join(SCRIPTS_DIR, 'proposal.mjs');
export const APPROVE = join(SCRIPTS_DIR, 'approve.mjs');
export const LEDGER = join(SCRIPTS_DIR, 'ledger.mjs');
export const APPLY = join(SCRIPTS_DIR, 'apply.mjs');
export const VERIFY = join(SCRIPTS_DIR, 'verify.mjs');

export function tmp(prefix = 'calibrate-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Runs a script with node; the environment never points at the real ~/.qodo.
export function run(script, args, { env = {}, cwd } = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, QODO_HOME: env.QODO_HOME ?? tmp('qodo-home-'), ...env },
  });
  let json = null;
  try { json = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* not JSON */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

// A run dir with a pinned rubric snapshot; optional rubric.yaml content.
export function makeRun(rubricYaml = null) {
  const base = tmp();
  const runDir = join(base, 'runs', '20260101-000000');
  mkdirSync(runDir, { recursive: true });
  const rubricPath = join(base, 'rubric.yaml');
  if (rubricYaml !== null) writeFileSync(rubricPath, rubricYaml);
  const res = run(RUBRIC, ['--rubric', rubricPath, '--snapshot', join(runDir, 'rubric-snapshot.yaml')]);
  if (res.status !== 0) throw new Error(`rubric setup failed: ${res.stderr}`);
  return { base, runDir, rubricPath, rubric: res.json };
}

// Effective classification rows (last line per rule) and every appended line, from the run folder.
export function classificationRows(runDir) {
  return readClassification(runDir) ?? [];
}
export function classificationLines(runDir) {
  return readClassificationLines(runDir) ?? [];
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeBatch(runDir, n, rules) {
  mkdirSync(join(runDir, 'batches'), { recursive: true });
  writeFileSync(join(runDir, 'batches', `batch-${String(n).padStart(3, '0')}.json`), JSON.stringify({ run_id: 'test', batch: n, rules }));
}

export function pageLog(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((o) => [o.page, o.size]); } catch { return []; }
}

// A run folder inside its own QODO_HOME with batch 1 classified: the state the proposal starts
// from. `rules` are batch/export rules (ruleId, name, category, severity, content, guard_hits,
// url); `tags` maps every ruleId in batch 1 to a taxonomy tag. Batch 2 stays unclassified unless
// `classifyBatch2` is set, so an incomplete classification is one flag away.
export function makeCalibrated({ rules, tags, rubricYaml = 'version: 1\n', runId = '20260101-000000', batch2 = [], classifyBatch2 = false } = {}) {
  const home = tmp('qodo-home-');
  const calibrate = join(home, 'calibrate');
  const runDir = join(calibrate, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const rubricPath = join(calibrate, 'rubric.yaml');
  writeFileSync(rubricPath, rubricYaml);
  const env = { QODO_HOME: home };
  const setup = run(RUBRIC, ['--rubric', rubricPath, '--snapshot', join(runDir, 'rubric-snapshot.yaml')], { env });
  if (setup.status !== 0) throw new Error(`rubric setup failed: ${setup.stderr}`);
  writeBatch(runDir, 1, rules);
  if (batch2.length) writeBatch(runDir, 2, batch2);
  writeExport(runDir, [...rules, ...batch2], runId);
  const rec = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify(tags)], { env });
  if (rec.status !== 0) throw new Error(`record batch 1 failed: ${rec.stderr}`);
  if (classifyBatch2 && batch2.length) {
    const t = Object.fromEntries(batch2.map((r) => [String(r.ruleId), tags[String(r.ruleId)] ?? 'logging']));
    const rec2 = run(RECORD, ['--run', runDir, '--batch', '2', '--tags', JSON.stringify(t)], { env });
    if (rec2.status !== 0) throw new Error(`record batch 2 failed: ${rec2.stderr}`);
  }
  return { home, calibrate, runDir, runId, rubricPath, env, ledger: join(calibrate, 'decisions.jsonl') };
}

export function writeExport(runDir, rules, runId = 'test') {
  writeFileSync(join(runDir, 'export.json'), JSON.stringify({
    run_id: runId,
    exported_at: '2026-01-01T00:00:00.000Z',
    totalCount: rules.length,
    rules: rules.map((r) => ({ ruleId: r.ruleId, name: r.name, category: r.category, severity: r.severity, content: r.content, url: r.url ?? null })),
  }));
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

// The proposal's rows, in file order, with their 1-based line numbers.
export function proposalRows(text) {
  return text.split('\n').map((line, i) => ({ line: i + 1, text: line })).filter((l) => /^- \[/.test(l.text));
}

// One parsed JSON line per fake `rules update` call (FAKE_UPDATE_LOG), in call order.
export function updateLog(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

export function applyResults(runDir) {
  try { return readFileSync(join(runDir, 'apply-results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

// The receipt's rows as [ruleId, effectiveStatus] pairs, in file order.
export function receiptStatuses(runDir) {
  const rows = parseReceipt(readText(join(runDir, 'receipt.md'))).rows;
  return rows.map((r) => [r.rule_id, r.status]);
}

// The same rows as [ruleId, applyState] pairs: what the loop did, with the verify-class tokens
// (`verified`, `mismatch(…)`) skipped and `failed(revert:…)` reading as `applied`.
export function receiptApplyStates(runDir) {
  const rows = parseReceipt(readText(join(runDir, 'receipt.md'))).rows;
  return rows.map((r) => [r.rule_id, r.apply_state]);
}

// The receipt's frontmatter as a flat object.
export function receiptFrontmatter(runDir) {
  return parseReceipt(readText(join(runDir, 'receipt.md'))).frontmatter;
}

// The fake launcher's stand-in workspace file for this run: {ruleId: severity}, written by the
// fake's `rules update` branch and overlaid by its `rules list` branch.
export function workspaceFile(ctx) {
  return join(ctx.runDir, 'fake-workspace.json');
}

export function seedWorkspace(ctx, severities) {
  writeFileSync(workspaceFile(ctx), JSON.stringify(Object.fromEntries(Object.entries(severities).map(([k, v]) => [String(k), v]))));
  return workspaceFile(ctx);
}

export function readWorkspace(ctx) {
  try { return JSON.parse(readFileSync(workspaceFile(ctx), 'utf8')); } catch { return {}; }
}

// The state the apply step starts from: a rendered proposal, the admin's edits applied, and a readback
// that confirms the counts. `edits` is a list of [linePrefix, replacement] pairs where the
// replacement is a string, a function of the line, or null to delete it — the same editor
// approve.test.mjs uses. Returns the context plus the readback JSON.
export function confirmed({ edits = [], rules = CALIB_RULES, tags = CALIB_TAGS, rubricYaml } = {}) {
  const ctx = makeCalibrated(rubricYaml === undefined ? { rules, tags } : { rules, tags, rubricYaml });
  const r = run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1'], { env: ctx.env });
  if (r.status !== 0) throw new Error(`render failed: ${r.stderr}`);
  ctx.proposal = join(ctx.runDir, 'proposal.md');
  ctx.receipt = join(ctx.runDir, 'receipt.md');
  ctx.script = join(ctx.runDir, 'apply.sh');
  ctx.revert = join(ctx.runDir, REVERT_SCRIPT_FILE);
  if (edits.length) {
    const text = readText(ctx.proposal).split('\n').flatMap((line) => {
      for (const [match, replace] of edits) {
        if (line.startsWith(match)) {
          if (replace === null) return [];
          return [typeof replace === 'function' ? replace(line) : replace];
        }
      }
      return [line];
    }).join('\n');
    writeFileSync(ctx.proposal, text);
  }
  const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  if (rb.status !== 0) throw new Error(`readback failed: ${rb.stderr}`);
  ctx.readback = rb.json;
  return ctx;
}

// Runs the generated apply.sh in one shell invocation, the way the skill does.
export function runScript(ctx, env = {}) {
  const res = spawnSync('sh', [ctx.script], {
    encoding: 'utf8',
    env: { ...process.env, ...ctx.env, ...env },
  });
  let json = null;
  try { json = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* not JSON */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

// Runs the generated revert.sh in one shell invocation, the way the skill does.
export function revertScript(ctx, env = {}) {
  const res = spawnSync('sh', [join(ctx.runDir, REVERT_SCRIPT_FILE)], {
    encoding: 'utf8',
    env: { ...process.env, ...ctx.env, ...env },
  });
  let json = null;
  try { json = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* not JSON */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

export function ledgerLines(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

// One batch that exercises every kind of proposal row under the default rubric:
// two documentation decreases (ids out of order), a naming decrease, a style decrease, a
// secrets-handling increase that also carries guard hits, a guard-vetoed row, a
// category-vetoed row, and two rows the proposal must never show (unchanged).
export const CALIB_RULES = [
  { ruleId: 101, name: 'Public functions must have docstrings', category: 'Maintainability', severity: 'error', content: 'Every public class, function, and method has a triple-quoted docstring.', guard_hits: [] },
  { ruleId: 99, name: 'Comment exported constants', category: 'Maintainability', severity: 'error', content: 'Exported constants carry a short comment explaining the unit.', guard_hits: [] },
  { ruleId: 102, name: 'Modules use snake_case names', category: 'Maintainability', severity: 'error', content: 'Module file names are snake_case.', guard_hits: [] },
  { ruleId: 103, name: 'Keep lines under 120 columns', category: 'Quality', severity: 'warning', content: 'Lines wrap at 120 columns.', guard_hits: [] },
  { ruleId: 104, name: 'Never log session tokens', category: 'Security', severity: 'warning', content: 'Do not write raw session or API tokens to logs.', guard_hits: ['token', 'secret'], url: 'https://portal.example.com/rules/104' },
  { ruleId: 105, name: 'Document encryption-key helpers', category: 'Compliance', severity: 'warning', content: 'Encryption key helpers carry a docstring naming the key source.', guard_hits: ['encrypt'] },
  { ruleId: 106, name: 'Name security helpers clearly', category: 'Security', severity: 'warning', content: 'Security helpers are named for what they enforce.', guard_hits: [] },
  { ruleId: 107, name: 'Validate request bodies against the schema', category: 'Correctness', severity: 'error', content: 'Every handler validates its request body.', guard_hits: [] },
  { ruleId: 108, name: 'Tests must be deterministic', category: 'Quality', severity: 'warning', content: 'No wall-clock or network dependency in unit tests.', guard_hits: [] },
];
export const CALIB_TAGS = {
  101: 'documentation', 99: 'documentation', 102: 'naming', 103: 'style-formatting',
  104: 'secrets-handling', 105: 'documentation', 106: 'naming', 107: 'security-control', 108: 'test-hygiene',
};
// The ids the proposal renders, and the two it must hold back as unchanged.
export const CALIB_PRECHECKED = [99, 101, 102, 103, 104];
export const CALIB_DECISIONS = [105, 106];
export const CALIB_UNCHANGED = [107, 108];


