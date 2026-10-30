// Fluid renderer: turns the agent's JSON "ui" tree into DOM. No dependencies.

const MAX_DEPTH = 24;
const MAX_NODES = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

const STYLE_WHITELIST = new Set([
  'background', 'color', 'padding', 'margin', 'border', 'borderRadius', 'boxShadow', 'width', 'height',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flex', 'gap', 'opacity', 'transform', 'filter',
  'backdropFilter', 'clipPath', 'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'lineHeight',
  'textAlign', 'position', 'left', 'top', 'right', 'bottom', 'zIndex', 'overflow', 'alignSelf',
  'gridColumn', 'gridRow', 'transition',
]);
const BAD_VALUE = ['url(', 'expression', 'javascript:', '@import'];

// Module-level state that survives re-renders.
let latestApi = null;
let liveIframes = [];
const lastSpecValue = new Map(); // input name -> JSON of last spec value
const tabState = new Map(); // tab node id -> active index
let messageListenerAdded = false;

// ---------- helpers ----------

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  return el;
}

function isBad(v) {
  const s = String(v).toLowerCase();
  return BAD_VALUE.some((b) => s.includes(b));
}

function num(v, dflt) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

function px(v) {
  const n = num(v, null);
  return n === null ? null : n + 'px';
}

function token(v) {
  return typeof v === 'string' && /^[a-zA-Z\- ]{1,30}$/.test(v) ? v : null;
}

function applyStyle(el, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return;
  for (const k of Object.keys(style)) {
    if (!STYLE_WHITELIST.has(k)) continue;
    const v = style[k];
    if (v === null || v === undefined || typeof v === 'object') continue;
    if (isBad(v)) continue;
    try { el.style[k] = String(v); } catch { /* ignore */ }
  }
}

function sanitizeId(id) {
  if (typeof id !== 'string' && typeof id !== 'number') return '';
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function placeholder(type) {
  return h('span', 'f-unknown', '[' + String(type).slice(0, 40) + ']');
}

function fmtNum(n) {
  try {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch { return String(Math.round(n * 100) / 100); }
}

// ---------- safe markdown ----------

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function emphasis(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
}

function mdInline(s) {
  const codes = [];
  const links = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, t, u) => {
    links.push('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + emphasis(t) + '</a>');
    return '\u0001' + (links.length - 1) + '\u0001';
  });
  s = emphasis(s);
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => links[+i]);
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[+i] + '</code>');
  return s;
}

export function markdownToHtml(src) {
  const lines = escapeHtml(String(src ?? '').replace(/[\u0000\u0001]/g, '')).split(/\r?\n/);
  const out = [];
  let para = [];
  let list = null; // 'ul' | 'ol'
  let fence = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const line of lines) {
    if (fence) {
      if (/^\s*```/.test(line)) { out.push('<pre><code>' + fence.join('\n') + '</code></pre>'); fence = null; }
      else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); closeList(); fence = []; continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara(); closeList();
      out.push('<h' + m[1].length + '>' + mdInline(m[2]) + '</h' + m[1].length + '>');
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + mdInline(m[1]) + '</li>');
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + mdInline(m[1]) + '</li>');
    } else if (!line.trim()) {
      flushPara(); closeList();
    } else {
      closeList(); para.push(line.trim());
    }
  }
  if (fence) out.push('<pre><code>' + fence.join('\n') + '</code></pre>');
  flushPara(); closeList();
  return out.join('');
}

// ---------- html sandbox messaging ----------

function ensureMessageListener() {
  if (messageListenerAdded || typeof window === 'undefined' || !window.addEventListener) return;
  messageListenerAdded = true;
  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object' || d.fluid !== 'action' || typeof d.action !== 'string') return;
    if (!liveIframes.some((f) => f.contentWindow && f.contentWindow === event.source)) return;
    try { latestApi?.onAction?.(d.action, d.payload); } catch (e) { console.error(e); }
  });
}

// ---------- inputs ----------

function resolveValue(node, name) {
  const api = latestApi;
  if (!api.values) api.values = {};
  if ('value' in node) {
    const sig = JSON.stringify(node.value ?? null);
    if (lastSpecValue.get(name) !== sig) {
      lastSpecValue.set(name, sig);
      if (node.value !== undefined) api.values[name] = node.value;
    }
  }
  return api.values[name] !== undefined ? api.values[name] : node.value;
}

function commit(name, value) {
  latestApi.values[name] = value;
  try { latestApi.onValue?.(name, value); } catch (e) { console.error(e); }
}

function field(node, name, control, extraCls) {
  const wrap = h('label', 'f-field ' + (extraCls || ''));
  const label = typeof node.label === 'string' ? node.label : '';
  if (label) wrap.append(h('span', 'f-label', label));
  else control.setAttribute('aria-label', name);
  wrap.append(control);
  return wrap;
}

function inputName(node) {
  return typeof node.name === 'string' && node.name ? node.name : sanitizeId(node.id);
}

// ---------- chart ----------

const PALETTE = [
  'var(--accent)', 'var(--fg)', 'var(--quiet)',
  'color-mix(in srgb, var(--accent) 55%, var(--bg))',
  'color-mix(in srgb, var(--fg) 45%, var(--bg))',
  'color-mix(in srgb, var(--accent) 30%, var(--bg))',
];
const col = (i) => PALETTE[i % PALETTE.length];

function styled(el, style) { Object.assign(el.style, style); return el; }

function svgText(x, y, text, anchor, cls) {
  const t = svg('text', { x, y, 'text-anchor': anchor, class: cls || 'f-chart-label' });
  t.textContent = String(text);
  return t;
}

function buildChart(node) {
  const kind = ['bar', 'line', 'area', 'donut'].includes(node.kind) ? node.kind : 'bar';
  const data = (Array.isArray(node.data) ? node.data : [])
    .filter((d) => d && typeof d === 'object')
    .map((d) => ({ label: String(d.label ?? ''), value: num(d.value, 0) }))
    .slice(0, 200);
  const W = 400;
  const H = Math.max(80, Math.min(800, num(node.height, 200)));
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'f-chart', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  root.setAttribute('aria-label', kind + ' chart: ' + data.map((d) => d.label + ' ' + d.value).join(', ').slice(0, 300));
  if (!data.length) { root.append(svgText(W / 2, H / 2, 'no data', 'middle')); return root; }

  if (kind === 'donut') {
    const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1;
    const R = H / 2 - 8, cx = H / 2, cy = H / 2, r0 = R * 0.62;
    let a = -Math.PI / 2;
    data.forEach((d, i) => {
      const frac = Math.min(0.9999, Math.max(0, d.value) / total);
      if (frac <= 0) return;
      const a2 = a + frac * Math.PI * 2;
      const big = frac > 0.5 ? 1 : 0;
      const p = (rad, ang) => (cx + rad * Math.cos(ang)).toFixed(2) + ' ' + (cy + rad * Math.sin(ang)).toFixed(2);
      const path = svg('path', {
        d: 'M' + p(R, a) + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + p(R, a2) + 'L' + p(r0, a2) +
          'A' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + p(r0, a) + 'Z',
      });
      path.style.fill = col(i);
      const t = svg('title'); t.textContent = d.label + ': ' + d.value;
      path.append(t);
      root.append(path);
      a = a2;
    });
    const lx = H + 16;
    const rowH = Math.min(22, (H - 16) / Math.max(1, data.length));
    data.slice(0, 12).forEach((d, i) => {
      const y = 14 + i * rowH;
      const sw = svg('rect', { x: lx, y: y - 9, width: 10, height: 10, rx: 2 });
      sw.style.fill = col(i);
      root.append(sw, svgText(lx + 16, y, d.label.slice(0, 22) + ' ' + Math.round((Math.max(0, d.value) / total) * 100) + '%', 'start'));
    });
    return root;
  }

  const pl = 36, pr = 8, pt = 10, pb = 24;
  const pw = W - pl - pr, ph = H - pt - pb;
  const vmin = Math.min(0, ...data.map((d) => d.value));
  let vmax = Math.max(0, ...data.map((d) => d.value));
  if (vmax === vmin) vmax = vmin + 1;
  const y = (v) => pt + ((vmax - v) / (vmax - vmin)) * ph;
  const slot = pw / data.length;
  const xc = (i) => pl + (i + 0.5) * slot;

  [vmax, (vmax + vmin) / 2, vmin].forEach((v) => {
    const ln = svg('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), class: 'f-chart-grid' });
    root.append(ln, svgText(pl - 4, y(v) + 3, fmtNum(v), 'end'));
  });
  const base = svg('line', { x1: pl, x2: W - pr, y1: y(0), y2: y(0), class: 'f-chart-axis' });
  root.append(base);

  if (kind === 'bar') {
    const bw = Math.min(48, slot * 0.7);
    data.forEach((d, i) => {
      const y0 = y(0), y1 = y(d.value);
      const r = svg('rect', { x: xc(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y0 - y1)), rx: 2 });
      r.style.fill = 'var(--accent)';
      const t = svg('title'); t.textContent = d.label + ': ' + d.value;
      r.append(t);
      root.append(r);
    });
  } else {
    const pts = data.map((d, i) => xc(i).toFixed(2) + ' ' + y(d.value).toFixed(2));
    if (kind === 'area') {
      const ar = svg('path', { d: 'M' + xc(0) + ' ' + y(0) + 'L' + pts.join('L') + 'L' + xc(data.length - 1) + ' ' + y(0) + 'Z', class: 'f-chart-area' });
      ar.style.fill = 'var(--accent)';
      root.append(ar);
    }
    const ln = svg('path', { d: 'M' + pts.join('L'), class: 'f-chart-line', fill: 'none' });
    ln.style.stroke = 'var(--accent)';
    root.append(ln);
    data.forEach((d, i) => {
      const c = svg('circle', { cx: xc(i), cy: y(d.value), r: 3 });
      c.style.fill = 'var(--accent)';
      const t = svg('title'); t.textContent = d.label + ': ' + d.value;
      c.append(t);
      root.append(c);
    });
  }
  const step = Math.ceil(data.length / 10);
  data.forEach((d, i) => { if (i % step === 0) root.append(svgText(xc(i), H - 8, d.label.slice(0, 10), 'middle')); });
  return root;
}

// ---------- node builders ----------

const BUILDERS = {
  stack(node, c) {
    const el = h('div', 'f-stack');
    if (node.dir === 'h') el.style.flexDirection = 'row';
    const g = px(node.gap); if (g) el.style.gap = g;
    const al = token(node.align); if (al) el.style.alignItems = al;
    const ju = token(node.justify); if (ju) el.style.justifyContent = ju;
    if (node.wrap) el.style.flexWrap = 'wrap';
    c.kids(el);
    return el;
  },
  grid(node, c) {
    const el = h('div', 'f-grid');
    if (typeof node.cols === 'number' && node.cols >= 1) {
      el.style.gridTemplateColumns = 'repeat(' + Math.min(24, Math.floor(node.cols)) + ', minmax(0, 1fr))';
    } else if (typeof node.cols === 'string' && !isBad(node.cols) && node.cols.length < 200) {
      el.style.gridTemplateColumns = node.cols;
    }
    const g = px(node.gap); if (g) el.style.gap = g;
    c.kids(el);
    return el;
  },
  free(node, c) {
    const el = h('div', 'f-free');
    el.style.height = (num(node.height, 400)) + 'px';
    c.kids(el);
    return el;
  },
  card(node, c) {
    const el = h('div', 'f-card');
    const p = px(node.padding); if (p) el.style.padding = p;
    c.kids(el);
    return el;
  },
  split(node, c) {
    const el = h('div', 'f-split');
    const r = Math.min(0.95, Math.max(0.05, num(node.ratio, 0.5)));
    el.style.gridTemplateColumns = r + 'fr ' + (1 - r) + 'fr';
    c.kids(el);
    return el;
  },
  tabs(node, c) {
    const el = h('div', 'f-tabs');
    const tabs = (Array.isArray(node.tabs) ? node.tabs : []).filter((t) => t && typeof t === 'object');
    const idKey = String(node.id);
    if (!tabState.has(idKey)) tabState.set(idKey, num(node.active, 0));
    const list = h('div', 'f-tablist');
    list.setAttribute('role', 'tablist');
    const panel = h('div', 'f-tabpanel');
    panel.setAttribute('role', 'tabpanel');
    const btns = [];
    const show = () => {
      let a = Math.floor(tabState.get(idKey));
      if (!(a >= 0 && a < tabs.length)) a = 0;
      btns.forEach((b, i) => {
        b.setAttribute('aria-selected', i === a ? 'true' : 'false');
        b.setAttribute('tabindex', i === a ? '0' : '-1');
      });
      panel.replaceChildren();
      const child = tabs[a] && tabs[a].child;
      const built = child ? c.build(child, c.depth + 1) : null;
      if (built) panel.append(built);
    };
    tabs.forEach((t, i) => {
      const b = h('button', 'f-tab', t.label ?? 'Tab ' + (i + 1));
      b.setAttribute('type', 'button');
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { tabState.set(idKey, i); show(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const j = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabState.set(idKey, j); show(); btns[j].focus();
      });
      btns.push(b); list.append(b);
    });
    show();
    el.append(list, panel);
    return el;
  },
  heading(node) {
    const lv = Math.min(3, Math.max(1, Math.floor(num(node.level, 2))));
    return h('h' + lv, 'f-heading', node.text ?? '');
  },
  text(node) {
    const el = h('p', 'f-text', node.text ?? '');
    const tone = ['normal', 'quiet', 'strong'].includes(node.tone) ? node.tone : 'normal';
    el.setAttribute('data-tone', tone);
    const s = px(node.size); if (s) el.style.fontSize = s;
    return el;
  },
  markdown(node) {
    const el = h('div', 'f-markdown');
    el.innerHTML = markdownToHtml(node.text); // escaped first, see markdownToHtml
    return el;
  },
  stat(node) {
    const el = h('div', 'f-stat');
    el.append(h('div', 'f-stat-label', node.label ?? ''), h('div', 'f-stat-value', node.value ?? ''));
    if (node.delta !== undefined && node.delta !== null && node.delta !== '') {
      const d = h('div', 'f-stat-delta', node.delta);
      const s = String(node.delta).trim();
      d.setAttribute('data-dir', s.startsWith('-') || s.startsWith('−') ? 'down' : s.startsWith('+') ? 'up' : 'flat');
      el.append(d);
    }
    return el;
  },
  badge(node) {
    const el = h('span', 'f-badge', node.text ?? '');
    const t = token(node.tone); if (t) el.setAttribute('data-tone', t);
    return el;
  },
  progress(node) {
    const v = Math.min(1, Math.max(0, num(node.value, 0)));
    const el = h('div', 'f-progress');
    if (node.label) el.append(h('div', 'f-progress-label', node.label));
    const bar = h('div', 'f-progress-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    bar.setAttribute('aria-label', typeof node.label === 'string' && node.label ? node.label : 'Progress');
    const fill = h('div', 'f-progress-fill');
    fill.style.width = (v * 100) + '%';
    bar.append(fill); el.append(bar);
    return el;
  },
  divider() { const el = h('hr', 'f-divider'); return el; },
  spacer(node) {
    const el = h('div', 'f-spacer');
    const s = px(node.size) || '16px';
    el.style.height = s; el.style.width = s;
    el.setAttribute('aria-hidden', 'true');
    return el;
  },
  list(node, c) {
    const el = h('ul', 'f-list');
    (Array.isArray(node.items) ? node.items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const li = h('li', 'f-list-li');
      const inner = it.action ? h('button', 'f-list-item') : h('div', 'f-list-item');
      if (it.action) {
        inner.setAttribute('type', 'button');
        inner.addEventListener('click', () => latestApi.onAction?.(it.action, it.payload));
      }
      if (it.icon) { const ic = h('span', 'f-list-icon', it.icon); ic.setAttribute('aria-hidden', 'true'); inner.append(ic); }
      const body = h('span', 'f-list-body');
      body.append(h('span', 'f-list-title', it.title ?? ''));
      if (it.subtitle) body.append(h('span', 'f-list-sub', it.subtitle));
      inner.append(body); li.append(inner); el.append(li);
    });
    return el;
  },
  table(node) {
    const wrap = h('div', 'f-table-wrap');
    const t = h('table', 'f-table');
    const cols = Array.isArray(node.columns) ? node.columns : [];
    if (cols.length) {
      const tr = h('tr');
      cols.forEach((cn) => { const th = h('th', '', cn); th.setAttribute('scope', 'col'); tr.append(th); });
      const head = h('thead'); head.append(tr); t.append(head);
    }
    const body = h('tbody');
    (Array.isArray(node.rows) ? node.rows : []).slice(0, 500).forEach((r) => {
      if (!Array.isArray(r)) return;
      const tr = h('tr');
      r.forEach((cell) => tr.append(h('td', '', cell ?? '')));
      body.append(tr);
    });
    t.append(body); wrap.append(t);
    return wrap;
  },
  chart(node) {
    const el = h('div', 'f-chart-wrap');
    el.append(buildChart(node));
    return el;
  },
  code(node) {
    const pre = h('pre', 'f-code');
    const code = h('code', '', node.text ?? '');
    if (typeof node.language === 'string') code.setAttribute('data-language', node.language.replace(/[^\w+#-]/g, '').slice(0, 20));
    pre.append(code);
    return pre;
  },
  image(node) {
    if (typeof node.src !== 'string' || !/^https:\/\//i.test(node.src)) return placeholder('image');
    const img = h('img', 'f-image');
    img.setAttribute('src', node.src);
    img.setAttribute('alt', typeof node.alt === 'string' ? node.alt : '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    return img;
  },
  html(node) {
    const f = h('iframe', 'f-html');
    f.setAttribute('sandbox', 'allow-scripts');
    // The mini-page may run scripts but gets no network: the CSP meta comes first so page content cannot override it.
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:">';
    f.setAttribute('srcdoc', csp + (typeof node.html === 'string' ? node.html : ''));
    f.setAttribute('title', typeof node.title === 'string' ? node.title : 'Embedded content');
    f.style.height = num(node.height, 320) + 'px';
    f.style.border = 'none';
    f.style.width = '100%';
    liveIframes.push(f);
    return f;
  },
  button(node) {
    const el = h('button', 'f-button ' + (node.variant === 'primary' ? 'is-primary' : 'is-quiet'), node.label ?? '');
    el.setAttribute('type', 'button');
    el.addEventListener('click', () => latestApi.onAction?.(node.action ?? node.label, node.payload));
    return el;
  },
  input(node) {
    const name = inputName(node);
    const kind = ['text', 'number', 'date', 'time'].includes(node.kind) ? node.kind : 'text';
    const el = h('input', 'f-control');
    el.setAttribute('type', kind);
    el.setAttribute('data-name', name);
    if (typeof node.placeholder === 'string') el.setAttribute('placeholder', node.placeholder);
    const v = resolveValue(node, name);
    if (v !== undefined && v !== null) el.value = String(v);
    el.addEventListener('input', () => {
      commit(name, kind === 'number' && el.value !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : el.value);
    });
    return field(node, name, el);
  },
  textarea(node) {
    const name = inputName(node);
    const el = h('textarea', 'f-control');
    el.setAttribute('data-name', name);
    el.setAttribute('rows', String(Math.min(40, Math.max(1, Math.floor(num(node.rows, 3))))));
    if (typeof node.placeholder === 'string') el.setAttribute('placeholder', node.placeholder);
    const v = resolveValue(node, name);
    if (v !== undefined && v !== null) el.value = String(v);
    el.addEventListener('input', () => commit(name, el.value));
    return field(node, name, el);
  },
  select(node) {
    const name = inputName(node);
    const el = h('select', 'f-control');
    el.setAttribute('data-name', name);
    const v = resolveValue(node, name);
    (Array.isArray(node.options) ? node.options : []).forEach((o) => {
      const label = o && typeof o === 'object' ? (o.label ?? o.value) : o;
      const value = o && typeof o === 'object' ? (o.value ?? o.label) : o;
      const opt = h('option', '', label);
      opt.setAttribute('value', String(value));
      if (v !== undefined && String(v) === String(value)) opt.setAttribute('selected', '');
      el.append(opt);
    });
    if (v !== undefined && v !== null) el.value = String(v);
    el.addEventListener('change', () => commit(name, el.value));
    return field(node, name, el);
  },
  slider(node) {
    const name = inputName(node);
    const el = h('input', 'f-control f-slider');
    el.setAttribute('type', 'range');
    el.setAttribute('data-name', name);
    el.setAttribute('min', String(num(node.min, 0)));
    el.setAttribute('max', String(num(node.max, 100)));
    el.setAttribute('step', String(num(node.step, 1)));
    const v = resolveValue(node, name);
    if (v !== undefined && v !== null) el.value = String(v);
    const out = h('output', 'f-slider-out', el.value);
    el.addEventListener('input', () => { out.textContent = el.value; commit(name, Number(el.value)); });
    const wrap = field(node, name, el, 'is-slider');
    wrap.append(out);
    return wrap;
  },
  toggle(node) {
    const name = inputName(node);
    const el = h('input', 'f-toggle');
    el.setAttribute('type', 'checkbox');
    el.setAttribute('role', 'switch');
    el.setAttribute('data-name', name);
    const v = resolveValue(node, name);
    el.checked = !!v;
    el.addEventListener('change', () => commit(name, el.checked));
    const wrap = h('label', 'f-field is-toggle');
    if (typeof node.label === 'string' && node.label) wrap.append(el, h('span', 'f-label', node.label));
    else { el.setAttribute('aria-label', name); wrap.append(el); }
    return wrap;
  },
};

// ---------- tree builder ----------

function makeContext(api) {
  const ctx = {
    api, seen: new Set(), count: 0, depth: 0,
    build(node, depth) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
      if (depth > MAX_DEPTH || ctx.count >= MAX_NODES) return null;
      ctx.count++;
      let el;
      try {
        const fn = Object.prototype.hasOwnProperty.call(BUILDERS, node.type) ? BUILDERS[node.type] : null;
        const c = { ...ctx, depth, kids(parent) {
          for (const k of Array.isArray(node.children) ? node.children : []) {
            const ce = ctx.build(k, depth + 1);
            if (ce) parent.append(ce);
          }
        } };
        el = fn ? fn(node, c) : placeholder(node.type);
        if (!el) return null;
        const sid = sanitizeId(node.id);
        if (sid) {
          el.setAttribute('data-id', sid);
          if (!ctx.seen.has(sid)) {
            ctx.seen.add(sid);
            el.style.viewTransitionName = 'n-' + sid;
          }
        }
        applyStyle(el, node.style);
      } catch (e) {
        console.error('fluid: node failed', node && node.id, e);
        return placeholder('error');
      }
      return el;
    },
  };
  return ctx;
}

function saveFocus(container) {
  try {
    const a = document.activeElement;
    if (!a || !container.contains || !container.contains(a)) return null;
    const name = a.getAttribute && a.getAttribute('data-name');
    if (!name) return null;
    let range = null;
    try { range = [a.selectionStart, a.selectionEnd, a.selectionDirection]; } catch { /* not text */ }
    return { name, range };
  } catch { return null; }
}

function restoreFocus(container, saved) {
  if (!saved) return;
  try {
    const els = container.querySelectorAll('[data-name]');
    for (const el of els) {
      if (el.getAttribute('data-name') !== saved.name) continue;
      el.focus({ preventScroll: true });
      if (saved.range && saved.range[0] !== null && saved.range[0] !== undefined) {
        try { el.setSelectionRange(saved.range[0], saved.range[1], saved.range[2] || 'none'); } catch { /* ignore */ }
      }
      break;
    }
  } catch { /* ignore */ }
}

export function renderTree(container, ui, api) {
  api = api || {};
  if (!api.values) api.values = {};
  latestApi = api;
  ensureMessageListener();
  const saved = saveFocus(container);
  liveIframes = [];
  const ctx = makeContext(api);
  let el = null;
  try { el = ui ? ctx.build(ui, 0) : null; } catch (e) { console.error(e); }
  if (el) container.replaceChildren(el); else container.replaceChildren();
  restoreFocus(container, saved);
}

// ---------- theme ----------

const MODES = ['light', 'dark'];
const FONTS = ['sans', 'serif', 'mono', 'rounded'];
const DENSITIES = ['compact', 'cozy', 'airy'];
const MOTIONS = ['none', 'calm', 'lively'];
const BACKDROPS = ['none', 'dots', 'grid', 'soft'];

export function applyTheme(rootEl, theme) {
  if (!rootEl) return;
  const t = theme && typeof theme === 'object' ? theme : {};
  rootEl.setAttribute('data-fluid', '');
  const setAttr = (attr, val, allowed) => {
    if (allowed.includes(val)) rootEl.setAttribute(attr, val); else rootEl.removeAttribute(attr);
  };
  setAttr('data-mode', t.mode, MODES);
  setAttr('data-font', t.font, FONTS);
  setAttr('data-density', t.density, DENSITIES);
  setAttr('data-motion', t.motion, MOTIONS);
  setAttr('data-backdrop', t.backdrop, BACKDROPS);
  const setVar = (name, val) => {
    if (typeof val === 'string' && val.length < 120 && !isBad(val) && !/[;{}]/.test(val)) rootEl.style.setProperty(name, val);
    else rootEl.style.removeProperty(name);
  };
  for (const k of ['bg', 'fg', 'accent', 'surface', 'quiet']) setVar('--' + k, t[k]);
  const r = num(t.radius, null);
  if (r !== null && r >= 0) rootEl.style.setProperty('--radius', Math.min(64, r) + 'px');
  else rootEl.style.removeProperty('--radius');
  if (typeof document !== 'undefined' && typeof t.title === 'string' && t.title) document.title = t.title.slice(0, 80);
}
