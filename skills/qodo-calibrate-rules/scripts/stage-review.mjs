#!/usr/bin/env node
// stage-review.mjs — build the self-contained browser review page for a run.
//
//   node stage-review.mjs --run <run-dir> [--out <file>]
//
// Reads review/index.html and review/review.js from the skill, inlines the module and the run's
// proposal.md, classification.jsonl, and export.json into one HTML file (default
// <run-dir>/review.html), and prints one JSON status line. The page then opens from file:// with
// no server: the admin reviews, clicks Commit decisions, and the browser downloads proposal.md.
// Node built-ins only. Writes only the output file.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_DIR = join(SKILL_DIR, 'review');

function usage(msg) {
  process.stderr.write(`stage-review: ${msg}\nusage: node stage-review.mjs --run <run-dir> [--out <file>]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { run: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') out.run = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else usage(`unknown argument ${a}`);
  }
  if (!out.run) usage('--run <run-dir> is required');
  return out;
}

// A JS string literal that is safe inside a <script> block: JSON escaping, then every `<` that
// could start `</script` or `<!--` written as \u003c so the HTML parser never sees a tag inside
// the data, and the U+2028/U+2029 line separators (which JSON leaves raw) escaped too.
export function jsString(text) {
  return JSON.stringify(text)
    .replace(/<(?=\/script|!--)/gi, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildReviewHtml({ html, moduleSource, proposal, classification, exportJson }) {
  if (/<\/script/i.test(moduleSource)) throw new Error('review.js must not contain "</script"');
  const data = `window.__CALIBRATE_DATA__ = { proposal: ${jsString(proposal)}, classification: ${jsString(classification)}, export: JSON.parse(${jsString(exportJson)}) };`;
  const tag = '<script type="module" src="./review.js"></script>';
  if (!html.includes(tag)) throw new Error(`review/index.html is missing ${tag}`);
  // A function replacer: a plain replacement string would interpret `$$`, `$&`, `$1` inside the data.
  return html.replace(tag, () => `<script>${data}</script>\n<script type="module">\n${moduleSource}\n</script>`);
}

export function stageReview(runDir, outPath = join(runDir, 'review.html')) {
  const need = (p, hint) => { if (!existsSync(p)) throw new Error(`${p} missing — ${hint}`); return readFileSync(p, 'utf8'); };
  const proposal = need(join(runDir, 'proposal.md'), 'render the proposal first (proposal.mjs --render)');
  const classification = need(join(runDir, 'classification.jsonl'), 'classify the batches first');
  const exportJson = need(join(runDir, 'export.json'), 'export the rules first (export-rules.mjs)');
  JSON.parse(exportJson); // fail here, not in the browser
  const html = need(join(REVIEW_DIR, 'index.html'), 'the skill install is incomplete');
  const moduleSource = need(join(REVIEW_DIR, 'review.js'), 'the skill install is incomplete');
  const runId = (proposal.match(/^run_id:\s*(\S+)/m) || [])[1] || null;
  const rows = proposal.split('\n').filter((l) => /^- \[( |x|X|\?)\] \d+ · /.test(l)).length;
  const out = buildReviewHtml({ html, moduleSource, proposal, classification, exportJson });
  writeFileSync(outPath, out);
  return { status: 'staged', path: outPath, run_id: runId, rows, bytes: Buffer.byteLength(out) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = stageReview(resolve(args.run), args.out ? resolve(args.out) : undefined);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ status: 'error', error: e.message }) + '\n');
    process.exit(2);
  }
}
