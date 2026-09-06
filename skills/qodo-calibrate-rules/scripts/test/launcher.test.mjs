import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, errorOf, TRUNCATED_CODE } from '../lib/launcher-lib.mjs';

// The classification table. A wrong answer here is the difference between one recorded row and a
// stranded batch, so every case that has bitten (or could) is listed explicitly.
const CASES = [
  // abort — the loop cannot make progress
  ['a local auth failure', { code: 'not_logged_in', message: 'Not logged in' }, '', 'abort'],
  ['a missing tool', { code: 'unknown_tool', message: 'unknown command: rules update' }, '', 'abort'],
  ['bad argv', { code: 'invalid_arguments', message: '--severity is required' }, '', 'abort'],
  ['any catalog_* code', { code: 'catalog_stale', message: 'catalog is stale' }, '', 'abort'],
  ['a launcher that will not spawn', { code: 'spawn_failed', message: 'ENOENT' }, '', 'abort'],
  ['a server code that names the denial', { code: 'MT-FORBIDDEN', message: 'permission denied' }, '', 'abort'],
  ['a permission denial stated only in prose', { code: 'unexpected_error', message: 'Admin permission required' }, '', 'abort'],

  // fail — record the row and carry on. These messages quote content, not a denial.
  ['a not-found whose message quotes the rule name', { code: 'MT-NOT-FOUND', message: "Rule 'Require authorization on admin routes' not found" }, '', 'fail'],
  ['a parse failure whose message quotes the page', { code: 'invalid_json', message: 'stdout is not a JSON object: <html>Forbidden</html>' }, '', 'fail'],
  ['a validation error quoting an auth rule', { code: 'MT-VALIDATION', message: "severity 'critical' invalid for 'Authorization checks'" }, '', 'fail'],
  ['an empty response quoting nothing', { code: 'empty_output', message: 'launcher printed nothing on stdout' }, '', 'fail'],
  ['a timeout', { code: 'timeout', message: 'rule 7 did not finish within 120000 ms' }, '', 'fail'],
  ['a non-zero exit', { code: 'non_zero_exit', message: 'launcher exited 1' }, '', 'fail'],
  ['a truncated result', { code: TRUNCATED_CODE, message: 'page result 290828 bytes exceeds the cap' }, '', 'fail'],
  ['a message about an author, not auth', { code: 'unexpected_error', message: 'Rule authored by the platform importer cannot be edited' }, '', 'fail'],
  ['a mismatch', { code: 'response_mismatch', message: 'came back at severity "warning"' }, '', 'fail'],

  // retry — the same row again after a backoff
  ['a rate limit in the JSON', { code: 'MT-RATE-LIMITED', message: 'slow down' }, '', 'retry'],
  ['an upstream outage', { code: 'MT-UPSTREAM-DOWN', message: 'upstream unavailable' }, '', 'retry'],
  ['a rate limit reported only on stderr', { code: 'empty_output', message: 'launcher printed nothing on stdout' }, 'MT-RATE-LIMITED: slow down\n', 'retry'],
  ['an upstream outage reported only on stderr', { code: 'non_zero_exit', message: 'launcher exited 1' }, 'MT-UPSTREAM-DOWN\n', 'retry'],
];

for (const [what, err, stderr, expected] of CASES) {
  test(`classifyError: ${what} is ${expected}`, () => {
    assert.equal(classifyError(err, stderr), expected);
  });
}

test('classifyError matches an auth signal in the code whatever the code list says', () => {
  // The code itself is the strong signal, so it is matched even for a code we do not know.
  assert.equal(classifyError({ code: 'MT-UNAUTHORIZED', message: 'nope' }), 'abort');
  assert.equal(classifyError({ code: 'permission_denied', message: '' }), 'abort');
});

test('classifyError prefers the retry class over an auth-looking message', () => {
  // A rate limit that happens to mention authorization is still a rate limit.
  assert.equal(classifyError({ code: 'MT-RATE-LIMITED', message: 'too many admin calls' }), 'retry');
});

test('errorOf accepts both documented error shapes', () => {
  assert.deepEqual(errorOf({ error: { code: 'MT-VALIDATION', message: 'bad' } }), { code: 'MT-VALIDATION', message: 'bad' });
  assert.deepEqual(errorOf({ code: 'MT-NOT-FOUND', message: 'gone' }), { code: 'MT-NOT-FOUND', message: 'gone' });
});

test('errorOf treats any truthy error key as a failure, code or not', () => {
  // A bare string, or an object with no code, must never be read as success.
  assert.deepEqual(errorOf({ error: 'permission denied' }), { code: 'unknown_error', message: 'permission denied' });
  assert.deepEqual(errorOf({ error: { message: 'something broke' } }), { code: 'unknown_error', message: 'something broke' });
  assert.equal(errorOf({ error: { detail: 'no message key' } }).code, 'unknown_error');
  assert.equal(errorOf({ error: { detail: 'no message key' } }).message, '{"detail":"no message key"}');
  assert.equal(errorOf({ error: true }).code, 'unknown_error');
  // …and a code-less error that reads like a denial still aborts the loop.
  assert.equal(classifyError(errorOf({ error: 'permission denied' })), 'abort');
});

test('errorOf reads the runtime truncation marker as an error', () => {
  const err = errorOf({ qar_operation_result_truncated: true, byte_size: 290828, max_bytes: 262144 });
  assert.equal(err.code, TRUNCATED_CODE);
  assert.match(err.message, /290828/);
});

test('errorOf leaves a real success alone', () => {
  assert.equal(errorOf({ ruleId: 7, name: 'r', severity: 'error' }), null);
  assert.equal(errorOf({ page: 1, totalCount: 2, rules: [] }), null);
  // An empty/false error key is not an error.
  assert.equal(errorOf({ ruleId: 7, error: null }), null);
  assert.equal(errorOf({ ruleId: 7, error: '' }), null);
});
