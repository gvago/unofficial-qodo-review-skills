// launcher-lib.mjs — the one launcher contract shared by every Qodo call this skill makes.
// Node built-ins only.
//
// Spawning, JSON parsing, error extraction, and stderr handling live here so the read path
// (export-rules.mjs paging rules-list) and the write path (apply.mjs calling rules update) treat
// the CLI identically: same timeout, same tolerance for stray stdout lines, same acceptance of
// both `{"error":{code,message}}` and a flat `{code,message}`, same detection of the runtime's
// truncation marker, and the same classification of an error into abort / retry / fail.

import { spawnSync } from 'node:child_process';

export const RATE_LIMIT_CODE = 'MT-RATE-LIMITED';
export const UPSTREAM_DOWN_CODE = 'MT-UPSTREAM-DOWN';
export const TRUNCATED_CODE = 'result_too_large';
export const TIMEOUT_MS = 120000;

// Abort class: the loop cannot make progress and the remaining rows must stay pending.
export const ABORT_CODES = Object.freeze([
  'not_logged_in', 'tool_unavailable', 'unknown_tool', 'invalid_arguments', 'no_catalog', 'spawn_failed',
]);
export const RETRY_CODES = Object.freeze([RATE_LIMIT_CODE, UPSTREAM_DOWN_CODE]);

// Permission denials are server-supplied prose with no local code, so the message is matched too —
// but only for a code that could carry one. `auth` deliberately does not match
// "author"/"authored"/"authoring"/"authorship".
const AUTH_RE = /(auth(?!or(?:s|ed|ing|ship)?\b)|permission|forbidden|unauthori[sz]ed|admin)/i;

// Codes whose message is never an auth signal: transport and parse failures quote up to 200
// characters of the launcher's own stdout, and a server validation or not-found message quotes the
// rule's name — "Rule 'Require authorization on admin routes' not found" must not strand a batch.
const NON_AUTH_CODES = Object.freeze([
  'invalid_json', 'empty_output', 'timeout', 'non_zero_exit', 'spawn_failed', 'result_too_large',
  'MT-VALIDATION', 'MT-NOT-FOUND', 'MT-TOOL-LOOP',
]);

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function stderrTail(stderr) {
  const lines = (stderr || '').split('\n').filter((l) => l.trim() && !/^\s*trace\s+[0-9a-f]+\s*$/i.test(l));
  const text = lines.join(' ').trim();
  return text.length > 300 ? `…${text.slice(-300)}` : text;
}

// The CLI's own trace lines are noise; anything else on stderr (QODO_NOTICE, warnings) is
// forwarded so the agent sees it.
export function forwardStderr(stderr, write = (s) => process.stderr.write(s)) {
  for (const line of (stderr || '').split('\n')) {
    if (line.trim() && !/^\s*trace\s+[0-9a-f]+\s*$/i.test(line)) write(`${line}\n`);
  }
}

export function parseJsonOutput(stdout) {
  const text = (stdout || '').trim();
  if (!text) return { error: { code: 'empty_output', message: 'launcher printed nothing on stdout' } };
  const attempts = [text];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{')) attempts.push(t);
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { payload: parsed };
    } catch { /* try the next candidate */ }
  }
  return { error: { code: 'invalid_json', message: `stdout is not a JSON object: ${text.slice(0, 200)}` } };
}

export function errorOf(payload) {
  // The CLI has emitted both {"error":{code,message}} and {code,message}; accept either. Any
  // truthy `error` key is a failure even when it carries no code — a bare string or a code-less
  // object must never be read as success.
  if (payload.error) {
    const e = payload.error;
    if (typeof e === 'object' && !Array.isArray(e) && e.code) return e;
    if (typeof e === 'string') return { code: 'unknown_error', message: e };
    const message = typeof e === 'object' && !Array.isArray(e) && e.message ? String(e.message) : JSON.stringify(e);
    return { code: 'unknown_error', message };
  }
  if (payload.code && payload.message && !Array.isArray(payload.rules)) return payload;
  // The runtime replaces a result above its byte cap with this marker (exit 0, no error key).
  if (payload.qar_operation_result_truncated === true) {
    return { code: TRUNCATED_CODE, message: `page result ${payload.byte_size} bytes exceeds the runtime cap of ${payload.max_bytes} bytes` };
  }
  return null;
}

export function spawnLauncher(launcher, argv, { timeout = TIMEOUT_MS } = {}) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout };
  if (/\.(mjs|cjs|js)$/i.test(launcher)) return spawnSync(process.execPath, [launcher, ...argv], opts);
  if (/\.(cmd|bat)$/i.test(launcher)) {
    // Node >= 20.12 refuses to spawn .cmd/.bat without a shell.
    const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    return spawnSync(quote(launcher), argv.map(quote), { ...opts, shell: true });
  }
  return spawnSync(launcher, argv, opts);
}

// abort — stop the loop, the row stays pending (auth, permission, missing tool, bad argv,
//         unusable catalog, a launcher that will not spawn).
// retry — the same row again after a backoff (rate limit, upstream down).
// fail  — record the row and continue (validation, not found, timeout, truncation, non-JSON, …).
export function classifyError(err, stderr = '') {
  const code = String(err?.code ?? '');
  const message = String(err?.message ?? '');
  if (RETRY_CODES.includes(code)) return 'retry';
  for (const retryCode of RETRY_CODES) if (String(stderr).includes(retryCode)) return 'retry';
  if (ABORT_CODES.includes(code)) return 'abort';
  if (/^catalog_/.test(code)) return 'abort';
  if (AUTH_RE.test(code)) return 'abort';
  if (!NON_AUTH_CODES.includes(code) && AUTH_RE.test(message)) return 'abort';
  return 'fail';
}
