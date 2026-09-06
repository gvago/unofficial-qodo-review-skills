// export-lib.mjs — the one read path against `rules-list`. Node built-ins only.
//
// `export-rules.mjs` pages the whole active set to build a run's export.json; `verify.mjs` pages
// the same set to read every rule's live severity back. They must page identically — the same
// page size, the same truncation halving, the same one rate-limit retry, the same shape checks —
// or a verify could disagree with an export for no reason but a different reader. So the paging
// lives here and both scripts call `fetchAll`.
//
// Unlike the rest of the run scripts nothing here exits: `fetchAll` throws an `ExportError`
// carrying `{ code, message }` and the caller decides the prefix and the exit code (both use 2).

import { errorOf, forwardStderr, parseJsonOutput, RATE_LIMIT_CODE, sleep, spawnLauncher, stderrTail, TIMEOUT_MS, TRUNCATED_CODE } from './launcher-lib.mjs';

export const PAGE_SIZE = 100; // rules-list maximum; halved when the runtime truncates a page
export const MIN_PAGE_SIZE = 10;
export const RATE_LIMIT_WAIT_MS = 5000;
export const PAGE_TIMEOUT_MS = TIMEOUT_MS;
export const DEFAULT_READ_ARGS = 'read rules list';

export class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function runPage(launcher, readArgs, page, pageSize) {
  const argv = [...readArgs, '--state', 'active', '--page-size', String(pageSize), '--page', String(page), '--json'];
  const res = spawnLauncher(launcher, argv);
  const tail = stderrTail(res.stderr);
  const withTail = (err) => ({ error: err, tail });
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return withTail({ code: 'timeout', message: `page ${page} did not finish within ${PAGE_TIMEOUT_MS / 1000} s` });
    return withTail({ code: 'spawn_failed', message: `${launcher}: ${res.error.message}` });
  }
  // Forward notices (e.g. QODO_NOTICE) but drop the CLI's trace lines.
  forwardStderr(res.stderr);
  if ((res.stderr || '').includes(RATE_LIMIT_CODE)) return withTail({ code: RATE_LIMIT_CODE, message: 'rate limited (reported on stderr)' });
  const parsed = parseJsonOutput(res.stdout);
  if (parsed.error) return withTail(parsed.error);
  const err = errorOf(parsed.payload);
  if (err) return withTail(err);
  if (res.status !== 0) return withTail({ code: 'non_zero_exit', message: `launcher exited ${res.status}` });
  const { payload } = parsed;
  if (!Array.isArray(payload.rules) || typeof payload.totalCount !== 'number') {
    return withTail({ code: 'unexpected_shape', message: `expected {page,totalCount,rules[]}, got keys ${Object.keys(payload).join(',')}` });
  }
  return { payload };
}

export function fetchPage(launcher, readArgs, page, pageSize, { name = 'export-rules' } = {}) {
  let attempt = runPage(launcher, readArgs, page, pageSize);
  if (attempt.error && attempt.error.code === RATE_LIMIT_CODE) {
    process.stderr.write(`${name}: page ${page} rate limited (${RATE_LIMIT_CODE}); waiting ${RATE_LIMIT_WAIT_MS / 1000}s and retrying once\n`);
    sleep(RATE_LIMIT_WAIT_MS);
    attempt = runPage(launcher, readArgs, page, pageSize);
  }
  return attempt;
}

export function describe(result, page, pageSize) {
  const e = result.error;
  const tail = result.tail ? ` (stderr: ${result.tail})` : '';
  return `page ${page} (page size ${pageSize}) failed: ${e.code} — ${e.message}${tail}`;
}

// Pages the whole active set. On a truncated page the page size is halved and paging resumes
// from the already-fetched prefix (after N-1 full pages of size S, page 2(N-1)+1 of size S/2).
// Returns { rules, totalCount, pages, pageSize }; throws ExportError on any failure. The messages
// never say what the caller did or did not write — the caller appends that.
export function fetchAll(launcher, readArgs, { name = 'export-rules' } = {}) {
  let pageSize = PAGE_SIZE;
  let page = 1;
  let rules = [];
  let totalCount = null;
  let pages = 0;
  for (;;) {
    const result = fetchPage(launcher, readArgs, page, pageSize, { name });
    if (result.error) {
      if (result.error.code !== TRUNCATED_CODE) {
        throw new ExportError('page_failed', `${describe(result, page, pageSize)}; fetched ${rules.length} of ${totalCount ?? 'unknown'} before the failure.`);
      }
      const smaller = Math.floor(pageSize / 2);
      if (smaller < MIN_PAGE_SIZE) throw new ExportError('page_size_floor', `page ${page} still truncated at page size ${pageSize} and the minimum is ${MIN_PAGE_SIZE} (${result.error.message}).`);
      if (rules.length % smaller === 0) {
        page = rules.length / smaller + 1;
        process.stderr.write(`${name}: page truncated by the runtime (${result.error.message}); keeping ${rules.length} fetched rules and continuing at page ${page} with page size ${smaller}\n`);
      } else {
        page = 1;
        rules = [];
        process.stderr.write(`${name}: page truncated by the runtime (${result.error.message}); page size ${smaller} does not align with the fetched prefix, restarting from page 1\n`);
      }
      pageSize = smaller;
      continue;
    }
    const { payload } = result;
    pages++;
    if (totalCount === null) totalCount = payload.totalCount;
    else if (payload.totalCount !== totalCount) {
      throw new ExportError('total_count_drift', `totalCount changed during paging (${totalCount} → ${payload.totalCount} on page ${page}); rules changed under us. Re-run.`);
    }
    if (payload.rules.length === 0) break;
    rules.push(...payload.rules);
    if (rules.length > totalCount) throw new ExportError('not_advancing', `paging is not advancing: ${rules.length} rules after page ${page} exceeds totalCount ${totalCount}.`);
    if (rules.length >= totalCount) break;
    page++;
  }
  return { rules, totalCount, pages, pageSize };
}
