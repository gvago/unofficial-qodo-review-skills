// review.js — the calibration review page. Vanilla ES module, no build step.
//
// The pure half (exported) parses proposal.md / classification.jsonl / export.json and produces
// the hand-off file. It mirrors scripts/lib/proposal-lib.mjs: ROW_RE is the same expression, and
// buildProposal rewrites only the checkbox and the target token of each row, so the output is
// exactly what approve.mjs --readback expects. The DOM half at the bottom only runs in a browser.
//
// scripts/stage-review.mjs inlines this module and the run's three files into one self-contained
// review.html (window.__CALIBRATE_DATA__), so the page opens from file:// with no server. When that
// global is absent the page falls back to fetching ./data/* — handy for developing against a
// static server, not something the skill uses.

export const ROW_RE = /^- \[( |x|X|\?)\] (\d+) · (.+) · (\S+) → (\S+)(?: · guard: ([^·]+))? · (\S+)\s*$/;
export const TAX = ['documentation', 'naming', 'style-formatting', 'import-order', 'test-hygiene', 'error-handling', 'logging', 'api-contract', 'architecture', 'correctness-contract', 'security-control', 'data-integrity', 'secrets-handling'];
export const SEVERITIES = ['error', 'warning', 'recommendation'];
export const P = { error: 'P0', warning: 'P1', recommendation: 'P2' };
const RANK = { recommendation: 0, warning: 1, error: 2 };

export const lbl = (s) => P[s] || s;
export const rank = (s) => RANK[s] ?? 1;

// ---- parsing -------------------------------------------------------------------------------

export function parseProposal(text) {
  const runId = (text.match(/^run_id:\s*(\S+)/m) || [])[1] || '';
  const rows = [];
  text.split('\n').forEach((line, i) => {
    const m = ROW_RE.exec(line);
    if (!m) return;
    const mid = m[3].split(' · ');
    rows.push({
      line: i,
      id: +m[2],
      prechecked: m[1] === 'x' || m[1] === 'X',
      deferred: m[1] === '?',
      name: mid[0],
      summary: mid.slice(1).join(' · '),
      current: m[4],
      target: m[5],
      guard: m[6] ? m[6].split(',').map((s) => s.trim()).filter(Boolean) : [],
      url: m[7],
    });
  });
  return { runId, rows };
}

// Last line per rule_id wins, matching the skill's append-only reader.
export function parseClassification(text) {
  const cls = {};
  text.split('\n').forEach((l) => {
    if (!l.trim()) return;
    try {
      const o = JSON.parse(l);
      if (o && o.rule_id != null) cls[o.rule_id] = o;
    } catch (_) { /* skip a half-written line */ }
  });
  return cls;
}

export function indexExport(exported) {
  const exp = {};
  ((exported && exported.rules) || []).forEach((r) => { exp[r.ruleId] = r; });
  return exp;
}

// ---- decisions -----------------------------------------------------------------------------

// A decision is { d: 'approve'|'skip'|'override', target, reviewed }. An undecided row is a
// deferral: it leaves the page as `[?]`, is never recorded, and is proposed again next run.
export function effective(decisions, row) {
  const d = decisions[row.id];
  if (d && d.d) return d;
  return { d: 'defer', reviewed: false };
}

export function groupKey(row, k) {
  if (!row.prechecked || (k && k.needs_decision)) return 'needs';
  const dir = k && k.direction && k.direction !== 'none' ? k.direction : (rank(row.target) > rank(row.current) ? 'increase' : 'decrease');
  return (dir === 'increase' ? 'inc:' : 'dec:') + (k && k.tag ? k.tag : 'other');
}

export function groupOrder(keys) {
  const order = ['needs', ...TAX.map((t) => 'inc:' + t), 'inc:other', ...TAX.map((t) => 'dec:' + t), 'dec:other'];
  const set = new Set(keys);
  const known = order.filter((k) => set.has(k));
  const extra = keys.filter((k) => !order.includes(k)).sort();
  return [...known, ...extra];
}

export function tally(rows, decisions, cls) {
  let approve = 0, skip = 0, override = 0, reviewed = 0, deferred = 0;
  const after = { error: 0, warning: 0, recommendation: 0 };
  Object.values(cls).forEach((k) => { if (after[k.current] != null) after[k.current]++; });
  rows.forEach((r) => {
    const d = effective(decisions, r);
    if (d.reviewed) reviewed++;
    if (d.d === 'approve') approve++;
    else if (d.d === 'skip') skip++;
    else if (d.d === 'defer') deferred++;
    else override++;
    const to = d.d === 'approve' ? r.target : d.d === 'override' ? d.target : null;
    if (to && after[r.current] != null && after[to] != null) { after[r.current]--; after[to]++; }
  });
  return { approve, skip, override, reviewed, deferred, after };
}

// ---- outputs -------------------------------------------------------------------------------

// Rewrites each row line in place: the checkbox, and for an override the token after ` → `.
// Frontmatter, headings, footer, and every other character are untouched.
export function buildProposal(rawProposal, rows, decisions) {
  const lines = rawProposal.split('\n');
  rows.forEach((r) => {
    const d = effective(decisions, r);
    let l = lines[r.line];
    if (l === undefined) return;
    l = l.replace(/^- \[( |x|X|\?)\]/, d.d === 'skip' ? '- [ ]' : d.d === 'defer' ? '- [?]' : '- [x]');
    if (d.d === 'override' && d.target) l = l.replace(' → ' + r.target + ' · ', ' → ' + d.target + ' · ');
    lines[r.line] = l;
  });
  return lines.join('\n');
}

// Splits rule text into plain / guard-hit segments for <mark> highlighting.
export function segments(text, guard) {
  if (!text) return [{ text: '(no rule text in export.json)', hit: false }];
  if (!guard.length) return [{ text, hit: false }];
  const re = new RegExp('(' + guard.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).filter(Boolean).map((t) => {
    const hit = re.test(t);
    re.lastIndex = 0;
    return { text: t, hit };
  });
}

export function overrideCycle(row, current) {
  const opts = SEVERITIES.filter((x) => x !== row.current && x !== row.target);
  if (!opts.length) return null;
  if (current.d === 'override') return opts[(opts.indexOf(current.target) + 1) % opts.length];
  return opts[0];
}

// ---- DOM -----------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class ReviewApp {
  constructor(root) {
    this.root = root;
    const params = new URLSearchParams(location.search);
    this.props = {
      density: params.get('density') === 'comfortable' ? 'comfortable' : 'compact',
      expandIncreases: /\binc\b/.test(params.get('expand') || ''),
      expandDecreases: /\bdec\b/.test(params.get('expand') || ''),
    };
    this.state = {
      loading: true, error: '', runId: '', rows: [], cls: {}, exp: {}, decisions: {}, expanded: {}, open: {},
      focusedId: null, query: '', undecidedOnly: false, guardOnly: false, undo: [], impl: null, hint: '', raw: '',
    };
    root.classList.toggle('comfortable', this.props.density === 'comfortable');
    this.$ = (sel) => this.root.querySelector(sel);
  }

  async load() {
    try {
      let p, c, e;
      const inline = typeof window !== 'undefined' && window.__CALIBRATE_DATA__;
      if (inline) {
        p = inline.proposal || '';
        c = inline.classification || '';
        e = inline.export || { rules: [] };
      } else {
        [p, c, e] = await Promise.all([
          fetch('data/proposal.md').then((r) => { if (!r.ok) throw new Error('data/proposal.md: HTTP ' + r.status); return r.text(); }),
          fetch('data/classification.jsonl').then((r) => { if (!r.ok) throw new Error('data/classification.jsonl: HTTP ' + r.status); return r.text(); }),
          fetch('data/export.json').then((r) => (r.ok ? r.json() : { rules: [] })).catch(() => ({ rules: [] })),
        ]);
      }
      const { runId, rows } = parseProposal(p);
      const cls = parseClassification(c);
      const exp = indexExport(e);
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('calibrate-review-' + runId) || '{}'); } catch (_) { /* fresh */ }
      const open = {};
      groupOrder([...new Set(rows.map((r) => groupKey(r, cls[r.id])))]).forEach((k) => {
        open[k] = k === 'needs' || (k.startsWith('inc:') && this.props.expandIncreases) || (k.startsWith('dec:') && this.props.expandDecreases);
      });
      Object.assign(this.state, { loading: false, runId, rows, cls, exp, raw: p, decisions: (saved && saved.decisions) || {}, open });
      document.title = 'Calibration Review · ' + runId;
    } catch (err) {
      Object.assign(this.state, { loading: false, error: String(err && err.message || err) });
    }
    this.renderAll();
  }

  persist() {
    try { localStorage.setItem('calibrate-review-' + this.state.runId, JSON.stringify({ decisions: this.state.decisions })); } catch (_) { /* private mode */ }
  }

  setDecisions(fn, label) {
    const s = this.state;
    s.undo = [{ decisions: s.decisions, label: label || 'last change' }, ...s.undo].slice(0, 30);
    s.decisions = fn(s.decisions);
    s.hint = '';
    if (s.impl && s.impl.done) s.impl = null; // a new decision reopens the commit
    this.persist();
  }
  undo() {
    const [top, ...rest] = this.state.undo;
    if (!top) return;
    this.state.decisions = top.decisions;
    this.state.undo = rest;
    this.persist();
    this.renderAll();
  }
  decide(id, patch) {
    this.setDecisions((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch, reviewed: true } }));
  }
  undecide(id) {
    this.setDecisions((d) => { const n = { ...d }; delete n[id]; return n; });
  }

  matches(r, k) {
    const s = this.state;
    if (s.guardOnly && !r.guard.length && !(k && k.needs_decision)) return false;
    if (s.undecidedOnly && effective(s.decisions, r).reviewed) return false;
    if (s.query) {
      const q = s.query.toLowerCase();
      if (!(String(r.id).includes(q) || r.name.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q))) return false;
    }
    return true;
  }

  buildGroups() {
    const s = this.state;
    const map = {};
    s.rows.forEach((r) => {
      const k = groupKey(r, s.cls[r.id]);
      (map[k] = map[k] || { all: [], rows: [] }).all.push(r);
      if (this.matches(r, s.cls[r.id])) map[k].rows.push(r);
    });
    return groupOrder(Object.keys(map)).map((key) => {
      const rows = map[key].rows.slice().sort((a, b) => (b.guard.length > 0) - (a.guard.length > 0) || a.id - b.id);
      return { key, all: map[key].all, rows, open: !!s.open[key] };
    });
  }
  visibleRows() {
    const out = [];
    this.buildGroups().forEach((g) => { if (g.open) out.push(...g.rows); });
    return out;
  }

  // ---- rendering ----
  renderAll() {
    this.renderSidebar();
    this.renderMain();
  }

  renderSidebar() {
    const s = this.state, t = tally(s.rows, s.decisions, s.cls);
    this.$('#run-id').textContent = 'run ' + (s.runId || '—');
    this.$('#reviewed-n').textContent = t.reviewed;
    this.$('#reviewed-total').textContent = ' / ' + s.rows.length;
    this.$('#progress-fill').style.width = (s.rows.length ? (t.reviewed / s.rows.length) * 100 : 0) + '%';
    this.$('#c-approve').textContent = t.approve;
    this.$('#c-skip').textContent = t.skip;
    this.$('#c-deferred').textContent = t.deferred;
    this.$('#c-override').textContent = t.override;
    this.$('#f-undecided').classList.toggle('on', s.undecidedOnly);
    this.$('#f-guard').classList.toggle('on', s.guardOnly);

    const groups = this.buildGroups();
    this.$('#nav').innerHTML = groups.map((g) => {
      const kind = g.key === 'needs' ? 'needs' : g.key.slice(0, 3);
      const tag = g.key.includes(':') ? g.key.split(':')[1] : '';
      const target = g.all[0] ? g.all[0].target : '';
      const rev = g.all.filter((r) => effective(s.decisions, r).reviewed).length;
      const done = g.all.length && rev === g.all.length;
      const label = g.key === 'needs' ? 'Needs a decision' : (kind === 'inc' ? '↑ ' : '↓ ') + lbl(target) + ' · ' + tag;
      const count = g.rows.length === g.all.length ? String(g.all.length) : g.rows.length + '/' + g.all.length;
      return `<button class="nav${done ? ' done' : ''}" data-jump="${esc(g.key)}"><span class="dot ${done ? 'done' : kind}"></span><span class="nav-label">${esc(label)}</span><span class="nav-count">${count}</span></button>`;
    }).join('');

    // footer
    const btn = this.$('#commit');
    const impl = s.impl;
    btn.disabled = !!(impl && !impl.done);
    btn.classList.toggle('running', !!(impl && !impl.done));
    btn.classList.toggle('done', !!(impl && impl.done));
    btn.textContent = impl ? (impl.done ? 'Decisions committed ✓' : 'Committing…') : 'Commit decisions';
    const steps = this.$('#steps');
    if (impl) {
      const labels = this.implSteps(t.approve, t.override, t.skip, t.deferred);
      steps.hidden = false;
      steps.innerHTML = labels.map((label, i) => {
        const st = impl.step > i ? 'done' : impl.step === i ? 'active' : 'todo';
        return `<div class="step ${st}"><span class="step-dot"></span><span>${esc(label)}</span></div>`;
      }).join('');
    } else { steps.hidden = true; steps.innerHTML = ''; }
    this.$('#hint').textContent = s.hint || (t.deferred
      ? t.deferred + ' undecided rows will be deferred to the next run, not skipped. Writes proposal.md in the skill’s row grammar.'
      : 'Every row decided. Writes proposal.md in the skill’s row grammar.');
    const u = this.$('#undo');
    u.hidden = !s.undo.length;
    u.textContent = s.undo.length ? 'Undo · ' + s.undo[0].label : '';
  }

  implSteps(a, o, k, u) {
    return [
      'Validate ' + (a + o + k + u) + ' rows · ' + a + ' approve · ' + o + ' override · ' + k + ' skip · ' + u + ' deferred',
      'Write proposal.md (checked = approve, edited → = override, [?] = deferred)',
      'Hand off to agent → readback → apply',
    ];
  }

  renderMain() {
    const s = this.state, t = tally(s.rows, s.decisions, s.cls);
    const needs = s.rows.filter((r) => groupKey(r, s.cls[r.id]) === 'needs').length;
    this.$('#h-total').textContent = s.rows.length + ' proposed severity changes';
    this.$('#h-sub').textContent = needs + ' need a decision · ' + (s.rows.length - needs) + ' pre-checked by the rubric · ' + Object.keys(s.cls).length + ' rules classified';
    this.$('#after-error').textContent = t.after.error + ' P0';
    this.$('#after-warning').textContent = t.after.warning + ' P1';
    this.$('#after-rec').textContent = t.after.recommendation + ' P2';

    const loading = this.$('#loading');
    loading.hidden = !s.loading && !s.error;
    loading.textContent = s.error ? 'Could not load the run: ' + s.error + ' — stage the page with stage-review.mjs (see SKILL.md) and reopen it.' : 'Loading proposal…';
    loading.classList.toggle('error', !!s.error);

    this.$('#groups').innerHTML = this.buildGroups().map((g) => this.groupHTML(g)).join('');
  }

  groupMeta(g) {
    const s = this.state;
    const kind = g.key === 'needs' ? 'needs' : g.key.slice(0, 3);
    const tag = g.key.includes(':') ? g.key.split(':')[1] : '';
    const target = g.all[0] ? g.all[0].target : '';
    const rev = g.all.filter((r) => effective(s.decisions, r).reviewed).length;
    const pct = g.all.length ? Math.round((rev / g.all.length) * 100) : 0;
    const title = g.key === 'needs' ? 'Guard or category conflict' : tag;
    const kindLabel = kind === 'needs' ? 'NEEDS A DECISION' : (kind === 'inc' ? 'INCREASE TO ' : 'DECREASE TO ') + lbl(target);
    return { kind, tag, target, rev, pct, title, kindLabel };
  }

  groupHTML(g) {
    const m = this.groupMeta(g);
    const domId = 'g-' + g.key.replace(':', '-');
    const rest = m.rev === 0 ? 'all' : 'rest';
    return `<section id="${domId}" class="group ${m.kind}${g.open ? ' open' : ''}" data-group="${esc(g.key)}">
      <div class="group-head">
        <button class="group-toggle" data-toggle="${esc(g.key)}"><span class="chev">▸</span><span class="kind ${m.kind}">${m.kindLabel}</span><span class="group-title">${esc(m.title)}</span></button>
        <div class="group-tools">
          <span class="group-progress">${m.rev}/${g.all.length} reviewed</span>
          <div class="bar"><div class="bar-fill${m.pct === 100 ? ' full' : ''}" style="width:${m.pct}%"></div></div>
          <button class="gbtn approve-all" data-bulk="approve" data-group="${esc(g.key)}" title="Approve the rows in this section you have not decided yet — your existing decisions are kept">Approve ${rest}</button>
          <button class="gbtn" data-bulk="skip" data-group="${esc(g.key)}" title="Skip the rows in this section you have not decided yet — your existing decisions are kept">Skip ${rest}</button>
          <button class="gbtn ghost" data-bulk="reset" data-group="${esc(g.key)}" title="Clear every decision in this section back to unreviewed">Reset</button>
        </div>
      </div>
      ${g.open ? `<div class="rows">${g.rows.map((r) => this.rowHTML(r, g)).join('')}${g.rows.length ? '' : '<div class="empty">No rows match the current filters.</div>'}</div>` : ''}
    </section>`;
  }

  rowHTML(r, g) {
    const s = this.state;
    const k = s.cls[r.id] || {}, x = s.exp[r.id] || {};
    const d = effective(s.decisions, r);
    const focused = s.focusedId === r.id, expanded = !!s.expanded[r.id];
    const skipped = d.d === 'skip';
    const held = skipped || d.d === 'defer';
    const effTarget = d.d === 'override' ? d.target : r.target;
    const category = k.category || x.category || '';
    const categoryConflict = g.key === 'needs' && !r.guard.length && /^(security|compliance)$/i.test(category);
    const decisionLine = d.reviewed
      ? (d.d === 'override' ? 'Override → ' + lbl(d.target) + ' (' + d.target + ')'
        : d.d === 'approve' ? 'Approved ' + lbl(r.current) + ' → ' + lbl(r.target)
          : 'Skipped — stays ' + lbl(r.current) + '; rubric proposed ' + lbl(r.target))
      : 'Not yet reviewed — deferred to the next run (stays ' + lbl(r.current) + ')';
    const opts = [['', '→'], ['error', 'P0'], ['warning', 'P1'], ['recommendation', 'P2']]
      .map(([v, l]) => `<option value="${v}"${(d.d === 'override' ? d.target : '') === v ? ' selected' : ''}>${l}</option>`).join('');
    let panel = '';
    if (expanded) {
      const segs = segments(x.content, r.guard).map((sg) => (sg.hit ? `<mark>${esc(sg.text)}</mark>` : esc(sg.text))).join('');
      panel = `<div class="panel">
        <div class="panel-main">
          ${r.summary ? `<div class="summary">${esc(r.summary)}</div>` : ''}
          <div class="ruletext-wrap"><span class="eyebrow">Rule text</span><div class="ruletext">${segs}</div></div>
          <div class="meta">
            <span>Category <b>${esc(category || '—')}</b></span>
            <span>Tag <b>${esc(k.tag || '—')}</b></span>
            <span>Scope <b class="mono">${esc((x.scopes || []).join(', ') || '—')}</b></span>
            <span>Source <b class="mono">${esc(x.source || '—')}</b></span>
            <a href="${esc(r.url)}" target="_blank" rel="noopener">Open in Qodo ↗</a>
          </div>
        </div>
        <div class="decision-line">${esc(decisionLine)}</div>
      </div>`;
    }
    return `<div id="row-${r.id}" class="row-wrap${focused ? ' focused' : ''}" data-row="${r.id}">
      <div class="row${skipped ? ' skipped' : ''}">
        <div class="cluster">
          <button class="dbtn approve${d.reviewed && d.d === 'approve' ? ' on' : ''}" data-act="approve" data-row="${r.id}" title="Approve (A)">✓</button>
          <button class="dbtn skip${d.reviewed && d.d === 'skip' ? ' on' : ''}" data-act="skip" data-row="${r.id}" title="Skip (S)">–</button>
          <select class="dsel${d.d === 'override' ? ' on' : ''}" data-override="${r.id}" title="Override severity (O)">${opts}</select>
        </div>
        <span class="rid">${r.id}</span>
        <div class="name-wrap" data-expand="${r.id}"><span class="name">${esc(r.name)}</span></div>
        ${categoryConflict ? `<span class="cat-chip" title="This rule's Qodo category is Security or Compliance, so the rubric will not lower it without your explicit approval."><span>Category</span>${esc(category)}</span>` : ''}
        <div class="sevs">
          <span class="chip ${esc(r.current)}${held ? '' : ' dim'}" title="Currently ${esc(r.current)}">${lbl(r.current)}</span>
          <span class="arrow">→</span>
          <span class="chip ${esc(effTarget)}${held ? ' ghosted' : ''}" title="${skipped ? 'Rubric proposed ' + esc(effTarget) + ' — not applied while skipped' : d.d === 'defer' ? 'Rubric proposed ' + esc(effTarget) + ' — deferred until you decide' : 'Will become ' + esc(effTarget)}">${lbl(effTarget)}</span>
        </div>
        <button class="row-chev${expanded ? ' open' : ''}" data-expand="${r.id}" title="Expand (E)">▸</button>
      </div>
      ${panel}
    </div>`;
  }

  // Re-render one row plus its group header and the sidebar — cheaper than the whole list.
  patchRow(id) {
    const s = this.state;
    const r = s.rows.find((x) => x.id === id);
    const el = this.root.querySelector('#row-' + id);
    if (!r || !el) { this.renderAll(); return; }
    const g = this.buildGroups().find((gg) => gg.key === groupKey(r, s.cls[r.id]));
    const tmp = document.createElement('div');
    tmp.innerHTML = this.rowHTML(r, g);
    el.replaceWith(tmp.firstElementChild);
    if (g) {
      const sec = this.root.querySelector('#g-' + g.key.replace(':', '-'));
      if (sec) {
        const m = this.groupMeta(g);
        sec.querySelector('.group-progress').textContent = m.rev + '/' + g.all.length + ' reviewed';
        const fill = sec.querySelector('.bar-fill');
        fill.style.width = m.pct + '%';
        fill.classList.toggle('full', m.pct === 100);
        const rest = m.rev === 0 ? 'all' : 'rest';
        sec.querySelector('[data-bulk="approve"]').textContent = 'Approve ' + rest;
        sec.querySelector('[data-bulk="skip"]').textContent = 'Skip ' + rest;
      }
    }
    this.renderHeaderCounts();
    this.renderSidebar();
  }
  renderHeaderCounts() {
    const s = this.state, t = tally(s.rows, s.decisions, s.cls);
    this.$('#after-error').textContent = t.after.error + ' P0';
    this.$('#after-warning').textContent = t.after.warning + ' P1';
    this.$('#after-rec').textContent = t.after.recommendation + ' P2';
  }

  setFocus(id, { scroll = true } = {}) {
    const prev = this.state.focusedId;
    this.state.focusedId = id;
    if (prev != null) { const pe = this.root.querySelector('#row-' + prev); if (pe) pe.classList.remove('focused'); }
    const el = this.root.querySelector('#row-' + id);
    if (el) el.classList.add('focused');
    if (el && scroll) {
      const main = this.$('#review-main');
      const r = el.getBoundingClientRect(), m = main.getBoundingClientRect();
      if (r.top < m.top + 90) main.scrollTop += r.top - m.top - 90;
      else if (r.bottom > m.bottom - 20) main.scrollTop += r.bottom - m.bottom + 20;
    }
  }

  // ---- events ----
  bind() {
    const s = this.state;
    const main = this.$('#review-main');

    this.$('#search').addEventListener('input', (e) => { s.query = e.target.value; this.renderAll(); });
    this.$('#f-undecided').addEventListener('click', () => { s.undecidedOnly = !s.undecidedOnly; this.renderAll(); });
    this.$('#f-guard').addEventListener('click', () => { s.guardOnly = !s.guardOnly; this.renderAll(); });
    this.$('#undo').addEventListener('click', () => this.undo());
    this.$('#commit').addEventListener('click', () => this.commit());

    this.$('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]');
      if (!b) return;
      const key = b.dataset.jump;
      s.open[key] = true;
      this.renderAll();
      const el = this.root.querySelector('#g-' + key.replace(':', '-'));
      if (el) main.scrollTop = el.offsetTop - 84;
    });

    main.addEventListener('click', (e) => {
      const t = e.target;
      const toggle = t.closest('[data-toggle]');
      if (toggle) { const k = toggle.dataset.toggle; s.open[k] = !s.open[k]; this.renderAll(); return; }
      const bulk = t.closest('[data-bulk]');
      if (bulk) { this.bulk(bulk.dataset.bulk, bulk.dataset.group); return; }
      const act = t.closest('[data-act]');
      if (act) {
        const id = +act.dataset.row, r = s.rows.find((x) => x.id === id), d = effective(s.decisions, r);
        const kind = act.dataset.act;
        act.blur();
        if (d.reviewed && d.d === kind) this.undecide(id); else this.decide(id, { d: kind, target: null });
        s.focusedId = id;
        this.patchRow(id);
        return;
      }
      const ex = t.closest('[data-expand]');
      if (ex) { const id = +ex.dataset.expand; s.expanded[id] = !s.expanded[id]; s.focusedId = id; this.patchRow(id); return; }
      const wrap = t.closest('[data-row]');
      if (wrap && !t.closest('select, input, a')) this.setFocus(+wrap.dataset.row, { scroll: false });
    });

    main.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-override]');
      if (!sel) return;
      const id = +sel.dataset.override, r = s.rows.find((x) => x.id === id), v = sel.value;
      if (!v) this.undecide(id);
      else if (v === r.current) this.decide(id, { d: 'skip', target: null });
      else if (v === r.target) this.decide(id, { d: 'approve', target: null });
      else this.decide(id, { d: 'override', target: v });
      s.focusedId = id;
      this.patchRow(id);
    });

    main.addEventListener('keydown', (e) => this.onKey(e));
  }

  bulk(kind, key) {
    const g = this.buildGroups().find((gg) => gg.key === key);
    if (!g) return;
    const title = this.groupMeta(g).title;
    if (kind === 'reset') {
      this.setDecisions((d0) => { const dd = { ...d0 }; g.rows.forEach((r) => { delete dd[r.id]; }); return dd; }, 'reset · ' + title);
    } else {
      this.setDecisions((d0) => {
        const dd = { ...d0 };
        g.rows.forEach((r) => { if (!(dd[r.id] && dd[r.id].reviewed)) dd[r.id] = { ...(dd[r.id] || {}), d: kind, target: null, reviewed: true }; });
        return dd;
      }, kind + ' ' + (this.groupMeta(g).rev === 0 ? 'all' : 'rest') + ' · ' + title);
    }
    this.renderAll();
  }

  onKey(e) {
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = this.state;
    const vis = this.visibleRows();
    if (!vis.length) return;
    let i = vis.findIndex((r) => r.id === s.focusedId);
    const key = e.key.toLowerCase();
    if (key === 'z') { e.preventDefault(); this.undo(); return; }
    if (key === 'j' || key === 'k') {
      e.preventDefault();
      i = key === 'j' ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
      this.setFocus(vis[i].id);
      return;
    }
    if (i < 0) return;
    const r = vis[i];
    const advance = () => { const n = vis[Math.min(vis.length - 1, i + 1)]; this.patchRow(r.id); if (n) this.setFocus(n.id); };
    if (key === 'a') { e.preventDefault(); this.decide(r.id, { d: 'approve', target: null }); advance(); }
    else if (key === 's') { e.preventDefault(); this.decide(r.id, { d: 'skip', target: null }); advance(); }
    else if (key === 'o') {
      e.preventDefault();
      const next = overrideCycle(r, effective(s.decisions, r));
      if (next) { this.decide(r.id, { d: 'override', target: next }); this.patchRow(r.id); this.setFocus(r.id, { scroll: false }); }
    } else if (key === 'e' || key === 'enter') {
      e.preventDefault();
      s.expanded[r.id] = !s.expanded[r.id];
      this.patchRow(r.id);
      this.setFocus(r.id, { scroll: false });
    }
  }

  download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  commit() {
    const s = this.state;
    if (s.impl && !s.impl.done) return;
    const t = tally(s.rows, s.decisions, s.cls);
    const proposal = buildProposal(s.raw, s.rows, s.decisions);
    s.impl = { step: 0, done: false };
    s.hint = '';
    this.renderSidebar();
    const n = this.implSteps(0, 0, 0).length;
    let i = 0;
    const tick = () => {
      i++;
      if (i === 1) this.download('proposal.md', proposal);
      if (i < n) { s.impl = { step: i, done: false }; this.renderSidebar(); setTimeout(tick, 600); return; }
      s.impl = { step: n, done: true };
      s.hint = 'Saved proposal.md to Downloads — ' + t.approve + ' approve · ' + t.override + ' override · ' + t.skip + ' skip'
        + (t.deferred ? ' · ' + t.deferred + ' deferred to the next run' : '')
        + '. Switch back to your agent: it picks it up, runs the readback, and asks for your final yes before applying.';
      this.renderSidebar();
    };
    setTimeout(tick, 600);
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  const app = new ReviewApp(document.getElementById('app'));
  app.bind();
  app.renderAll();
  app.load();
}
