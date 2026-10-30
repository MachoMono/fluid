import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './inspector.css';

const MAX_EVENTS = 800;
const STR_LIMIT = 400;
const SUMMARY_LIMIT = 120;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const short = (s) => (s == null ? '' : String(s).length > 8 ? String(s).slice(0, 8) : String(s));
const clip = (s, n = SUMMARY_LIMIT) => {
  s = String(s ?? '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const safeJSON = (v) => {
  try { return JSON.stringify(v, null, 2) ?? 'undefined'; } catch { return String(v); }
};
const compact = (v) => {
  try { return JSON.stringify(v) ?? 'undefined'; } catch { return String(v); }
};
const isObj = (v) => v !== null && typeof v === 'object';

function family(type) {
  if (type === 'RUN_ERROR') return 'error';
  if (/^TEXT_MESSAGE|^REASONING|^THINKING/.test(type)) return 'text';
  if (/^TOOL_CALL/.test(type)) return 'tool';
  if (/^STATE|^MESSAGES_SNAPSHOT/.test(type)) return 'state';
  return 'run';
}

/* ---------- JSON viewer ---------- */

function jsonTree(value, rootKey) {
  const wrap = el('div', 'dp-json');
  wrap.appendChild(jsonNode(rootKey, value, 0));
  return wrap;
}

function keyEl(key) {
  const k = el('span', 'j-key', typeof key === 'number' ? String(key) : JSON.stringify(String(key)));
  const colon = el('span', 'j-punct', ': ');
  const f = document.createDocumentFragment();
  f.append(k, colon);
  return f;
}

function jsonNode(key, value, depth) {
  const row = el('div', 'j-row');
  if (!isObj(value)) {
    if (key !== undefined && key !== null) row.appendChild(keyEl(key));
    row.appendChild(primitive(value));
    return row;
  }
  const isArr = Array.isArray(value);
  const keys = isArr ? null : Object.keys(value);
  const n = isArr ? value.length : keys.length;
  const d = el('details', 'j-details');
  d.open = depth < 2 && !(isArr && n > 12) && !(!isArr && n > 40);
  const s = el('summary', 'j-summary');
  if (key !== undefined && key !== null) s.appendChild(keyEl(key));
  s.appendChild(el('span', 'j-punct', isArr ? '[' : '{'));
  s.appendChild(el('span', 'j-meta', n === 0 ? '' : ` ${n} ${isArr ? (n === 1 ? 'item' : 'items') : (n === 1 ? 'key' : 'keys')} `));
  s.appendChild(el('span', 'j-punct', isArr ? ']' : '}'));
  d.appendChild(s);
  const body = el('div', 'j-body');
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    if (isArr) value.forEach((v, i) => body.appendChild(jsonNode(i, v, depth + 1)));
    else keys.forEach((k) => body.appendChild(jsonNode(k, value[k], depth + 1)));
  };
  if (d.open) build();
  d.addEventListener('toggle', () => { if (d.open) build(); });
  d.appendChild(body);
  row.appendChild(d);
  return row;
}

function primitive(v) {
  if (typeof v === 'string') {
    const span = el('span', 'j-str');
    const q1 = el('span', 'j-punct', '"');
    const txt = el('span', 'j-strtext');
    span.append(q1, txt);
    if (v.length <= STR_LIMIT) {
      txt.textContent = v;
      span.appendChild(el('span', 'j-punct', '"'));
      return span;
    }
    let open = false;
    const btn = el('button', 'j-toggle');
    btn.type = 'button';
    const q2 = el('span', 'j-punct', '"');
    const paint = () => {
      txt.textContent = open ? v : v.slice(0, STR_LIMIT) + '…';
      btn.textContent = open ? 'Collapse' : `Show all ${v.length.toLocaleString()} chars`;
      btn.setAttribute('aria-expanded', String(open));
      span.classList.toggle('is-open', open);
    };
    btn.addEventListener('click', () => { open = !open; paint(); });
    paint();
    span.append(q2, ' ', btn);
    return span;
  }
  const cls = typeof v === 'number' ? 'j-num' : v === null ? 'j-null' : typeof v === 'boolean' ? 'j-bool' : 'j-null';
  return el('span', cls, v === undefined ? 'undefined' : String(v));
}

/* ---------- node lookup ---------- */

function findNode(root, id, path = []) {
  if (!isObj(root)) return null;
  if (!Array.isArray(root) && root.id === id) {
    return { node: root, path: [...path, root.id ?? root.type ?? '?'] };
  }
  const kids = Array.isArray(root) ? root : Object.values(root);
  const label = !Array.isArray(root) && (root.id ?? root.type) != null ? [...path, root.id ?? root.type] : path;
  for (const k of kids) {
    const r = findNode(k, id, label);
    if (r) return r;
  }
  return null;
}

/* ---------- inspector ---------- */

export function createInspector(mount) {
  mount.classList.add('depths-root');
  mount.textContent = '';

  const events = { total: 0, kept: 0 };
  const runs = []; // {id, el, head parts, rowsEl, t0, status, duration, rows[]}
  const rows = []; // all rows in order
  let surfaceCb = null;
  let threadId = '';
  let protocol = '';
  let state = null;
  let prevKeyJSON = {};
  let stick = true;
  let selected = null;
  let tab = 'shape';
  let shapeNodeId = null;
  const tabText = { shape: '', state: '', event: '' };

  /* top */
  const top = el('header', 'dp-top');
  const back = el('button', 'dp-back');
  back.type = 'button';
  back.append(el('span', 'dp-back-label', 'Back to Flow'), el('kbd', 'dp-kbd', 'Esc'));
  back.addEventListener('click', () => { if (surfaceCb) surfaceCb(); });
  const title = el('h2', 'dp-title', 'Depth');
  const meta = el('p', 'dp-meta');
  top.append(back, title, meta);

  function paintMeta() {
    const parts = [];
    parts.push(threadId ? `thread ${short(threadId)}` : 'no thread yet');
    parts.push(`${events.total} event${events.total === 1 ? '' : 's'}`);
    if (protocol) parts.push(`protocol ${protocol}`);
    const last = runs[runs.length - 1];
    parts.push(last && last.status === 'running' ? 'run active' : 'idle');
    meta.textContent = parts.join('  ·  ');
  }

  /* stream */
  const streamSec = el('section', 'dp-stream');
  streamSec.setAttribute('aria-label', 'Event stream');
  const streamScroll = el('div', 'dp-scroll dp-stream-scroll');
  streamScroll.tabIndex = -1;
  const streamEmpty = el('p', 'dp-empty', 'Nothing has crossed the wire yet.');
  streamScroll.appendChild(streamEmpty);
  streamSec.appendChild(streamScroll);
  streamScroll.addEventListener('scroll', () => {
    stick = streamScroll.scrollHeight - streamScroll.scrollTop - streamScroll.clientHeight < 40;
  }, { passive: true });
  const toBottom = () => { if (stick) streamScroll.scrollTop = streamScroll.scrollHeight; };

  /* inspector pane */
  const pane = el('section', 'dp-pane');
  const tablist = el('div', 'dp-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Inspector');
  const TABS = [['shape', 'Shape'], ['state', 'State'], ['event', 'Event']];
  const tabEls = {};
  const panels = {};
  const bodies = {};
  const uid = 'dp' + Math.random().toString(36).slice(2, 7);

  TABS.forEach(([id, label]) => {
    const t = el('button', 'dp-tab', label);
    t.type = 'button';
    t.id = `${uid}-tab-${id}`;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', `${uid}-panel-${id}`);
    t.addEventListener('click', () => selectTab(id));
    t.addEventListener('keydown', (e) => {
      const i = TABS.findIndex(([k]) => k === tab);
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = TABS.length - 1;
      if (j < 0) return;
      e.preventDefault();
      selectTab(TABS[j][0]);
      tabEls[TABS[j][0]].focus();
    });
    tabEls[id] = t;
    tablist.appendChild(t);

    const p = el('div', 'dp-panel');
    p.id = `${uid}-panel-${id}`;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', t.id);
    p.tabIndex = 0;
    const bar = el('div', 'dp-bar');
    const heading = el('div', 'dp-bar-info');
    const copy = el('button', 'dp-copy', 'Copy JSON');
    copy.type = 'button';
    let timer = 0;
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(tabText[id] || ''); } catch { /* ignore */ }
      copy.textContent = 'Copied';
      clearTimeout(timer);
      timer = setTimeout(() => { copy.textContent = 'Copy JSON'; }, 1500);
    });
    bar.append(heading, copy);
    const body = el('div', 'dp-panel-body');
    p.append(bar, body);
    panels[id] = p;
    bodies[id] = { info: heading, body };
    pane.appendChild(p);
  });
  pane.prepend(tablist);

  function selectTab(id) {
    tab = id;
    for (const [k] of TABS) {
      const on = k === id;
      tabEls[k].setAttribute('aria-selected', String(on));
      tabEls[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    }
  }

  const bodyEl = el('div', 'dp-body');
  bodyEl.append(streamSec, pane);
  mount.append(top, bodyEl);

  /* ---- state tab ---- */
  const stateKeyEls = {};
  function paintState(first) {
    const { info, body } = bodies.state;
    if (!state) {
      info.textContent = 'No shared state yet';
      body.textContent = '';
      tabText.state = '';
      return;
    }
    const keys = Object.keys(state);
    info.textContent = `Shared state · ${keys.length} key${keys.length === 1 ? '' : 's'}`;
    tabText.state = safeJSON(state);
    const now = {};
    for (const k of keys) now[k] = compact(state[k]);
    for (const k of Object.keys(stateKeyEls)) {
      if (!(k in now)) { stateKeyEls[k].remove(); delete stateKeyEls[k]; }
    }
    keys.forEach((k, idx) => {
      const changed = prevKeyJSON[k] !== now[k];
      if (!changed && stateKeyEls[k]) return;
      const box = el('div', 'dp-statekey');
      box.appendChild(jsonTree(state[k], k));
      if (changed && !first) box.classList.add('flash');
      const old = stateKeyEls[k];
      if (old) old.replaceWith(box);
      else {
        const next = keys.slice(idx + 1).map((x) => stateKeyEls[x]).find(Boolean);
        body.insertBefore(box, next || null);
      }
      stateKeyEls[k] = box;
    });
    prevKeyJSON = now;
  }

  /* ---- shape tab ---- */
  function paintShape() {
    const { info, body } = bodies.shape;
    body.textContent = '';
    if (shapeNodeId == null) {
      info.textContent = 'Shape';
      tabText.shape = '';
      body.appendChild(el('p', 'dp-empty', 'Alt-click a part of Flow to dive into it and see its shape here.'));
      return;
    }
    const found = state && findNode(state.ui, shapeNodeId);
    if (!found) {
      info.textContent = `Shape · ${shapeNodeId}`;
      tabText.shape = '';
      body.appendChild(el('p', 'dp-empty', `No node with id "${shapeNodeId}" in the current interface.`));
      return;
    }
    const { node, path } = found;
    info.textContent = `Shape · ${node.id}`;
    tabText.shape = safeJSON(node);
    const dl = el('dl', 'dp-facts');
    const fact = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
    fact('Path', path.join(' › '));
    fact('Type', String(node.type ?? 'unknown'));
    fact('Children', String(Array.isArray(node.children) ? node.children.length : 0));
    body.appendChild(dl);

    const ch = el('div', 'dp-changed');
    ch.appendChild(el('h3', 'dp-sub', 'Changed in'));
    const list = changedIn(shapeNodeId);
    if (!list.length) ch.appendChild(el('p', 'dp-empty', 'No recorded snapshot contains this node.'));
    else {
      const ul = el('ul', 'dp-changed-list');
      for (const r of list) {
        const li = el('li');
        const b = el('button', 'dp-chip', `#${r.seq}`);
        b.type = 'button';
        b.setAttribute('aria-label', `Snapshot event ${r.seq}`);
        b.addEventListener('click', () => {
          selectRow(r);
          r.btn.scrollIntoView({ block: 'nearest' });
          tabEls.event.focus();
        });
        li.appendChild(b);
        ul.appendChild(li);
      }
      ch.appendChild(ul);
    }
    body.appendChild(ch);
    body.appendChild(el('h3', 'dp-sub', 'Spec'));
    body.appendChild(jsonTree(node));
  }

  function changedIn(id) {
    const out = [];
    let prev = null;
    for (const r of rows) {
      if (r.type !== 'STATE_SNAPSHOT') continue;
      const snap = r.events[0].event.snapshot;
      const f = isObj(snap) ? findNode(snap.ui ?? snap, id) : null;
      if (!f) continue;
      const j = compact(f.node);
      if (j !== prev) out.push(r);
      prev = j;
    }
    return out;
  }

  /* ---- event tab ---- */
  function eventPayload(r) {
    if (r.coalesced) {
      const o = { type: r.type, count: r.events.length, [r.keyName]: r.key, delta: r.joined };
      return o;
    }
    return r.events[0].event;
  }
  function paintEvent() {
    const { info, body } = bodies.event;
    body.textContent = '';
    if (!selected) {
      info.textContent = 'Event';
      tabText.event = '';
      body.appendChild(el('p', 'dp-empty', 'Select an event in the stream to read it in full.'));
      return;
    }
    const payload = eventPayload(selected);
    info.textContent = `Event #${selected.seq} · ${selected.type}`;
    tabText.event = safeJSON(payload);
    body.appendChild(jsonTree(payload));
  }

  function selectRow(r) {
    if (selected && selected.btn) selected.btn.setAttribute('aria-pressed', 'false');
    selected = r;
    r.btn.setAttribute('aria-pressed', 'true');
    paintEvent();
    selectTab('event');
  }

  /* ---- stream ---- */
  function newRun(id, t0) {
    const wrapEl = el('div', 'dp-run');
    const head = el('h3', 'dp-run-head');
    const name = el('span', 'dp-run-name');
    const status = el('span', 'dp-run-status');
    const dur = el('span', 'dp-run-dur');
    head.append(name, status, dur);
    const rowsEl = el('div', 'dp-rows');
    wrapEl.append(head, rowsEl);
    const run = { id, t0, status: id ? 'running' : 'idle', duration: null, el: wrapEl, rowsEl, name, statusEl: status, durEl: dur, count: 0 };
    runs.push(run);
    streamScroll.appendChild(wrapEl);
    paintRun(run);
    return run;
  }
  function paintRun(run) {
    run.name.textContent = run.id ? `Run ${short(run.id)}` : 'Before any run';
    run.statusEl.textContent = run.id ? run.status : '';
    run.statusEl.className = 'dp-run-status st-' + run.status;
    run.durEl.textContent = run.duration != null ? `${Math.round(run.duration)} ms` : '';
  }

  function summarize(ev) {
    switch (ev.type) {
      case 'RUN_STARTED': return `run ${short(ev.runId)}`;
      case 'RUN_FINISHED': return ev.result != null ? clip(compact(ev.result)) : 'done';
      case 'RUN_ERROR': return clip(ev.message || compact(ev));
      case 'STEP_STARTED': case 'STEP_FINISHED': return ev.stepName || '';
      case 'TEXT_MESSAGE_START': case 'TEXT_MESSAGE_END': return `${ev.role || ''} ${short(ev.messageId)}`.trim();
      case 'TOOL_CALL_START': return ev.toolCallName || short(ev.toolCallId);
      case 'TOOL_CALL_END': return short(ev.toolCallId);
      case 'TOOL_CALL_RESULT': return clip(typeof ev.content === 'string' ? ev.content : compact(ev.content));
      case 'STATE_SNAPSHOT': return isObj(ev.snapshot) ? 'keys: ' + Object.keys(ev.snapshot).join(', ') : '';
      case 'STATE_DELTA': return Array.isArray(ev.delta) ? `${ev.delta.length} op${ev.delta.length === 1 ? '' : 's'}: ` + clip(ev.delta.map((o) => `${o.op} ${o.path}`).join(', '), 80) : '';
      case 'MESSAGES_SNAPSHOT': return Array.isArray(ev.messages) ? `${ev.messages.length} messages` : '';
      case 'CUSTOM': return ev.name ? `${ev.name} ${clip(compact(ev.value), 80)}` : clip(compact(ev.value));
      default: {
        if (typeof ev.delta === 'string') return clip(ev.delta);
        const { type, timestamp, ...rest } = ev;
        return clip(compact(rest));
      }
    }
  }

  function coalesceKey(ev) {
    if (ev.type === 'TEXT_MESSAGE_CONTENT') return ['messageId', ev.messageId];
    if (ev.type === 'TOOL_CALL_ARGS') return ['toolCallId', ev.toolCallId];
    if (/^REASONING|^THINKING/.test(ev.type) && typeof ev.delta === 'string') return ['messageId', ev.messageId ?? ''];
    return null;
  }

  function paintRow(r) {
    r.timeEl.textContent = `${Math.round(r.t - r.run.t0)} ms`;
    r.typeEl.textContent = r.type;
    r.countEl.textContent = r.coalesced && r.events.length > 1 ? `×${r.events.length}` : '';
    r.sumEl.textContent = r.coalesced ? clip(r.joined) : summarize(r.events[0].event);
  }

  function dropOldest() {
    while (events.kept > MAX_EVENTS && rows.length) {
      const r = rows.shift();
      events.kept -= r.events.length;
      if (selected === r) { selected = null; paintEvent(); }
      r.btn.remove();
      r.run.count--;
      if (!r.run.count && r.run !== runs[runs.length - 1]) {
        r.run.el.remove();
        runs.splice(runs.indexOf(r.run), 1);
      }
    }
  }

  function record(event) {
    if (!isObj(event)) return;
    const t = performance.now();
    const type = String(event.type || 'UNKNOWN');
    const seq = ++events.total;
    events.kept++;
    streamEmpty.remove();

    if (type === 'RUN_STARTED') {
      if (event.threadId) threadId = event.threadId;
      if (event.protocolVersion) protocol = event.protocolVersion;
      newRun(event.runId, t);
    }
    let run = runs[runs.length - 1];
    if (!run) run = newRun(null, t);
    if (type === 'RUN_FINISHED' || type === 'RUN_ERROR') {
      run.status = type === 'RUN_ERROR' ? 'error' : 'finished';
      run.duration = t - run.t0;
      paintRun(run);
    }

    const entry = { seq, t, event };
    const ck = coalesceKey(event);
    const last = rows[rows.length - 1];
    if (ck && last && last.coalesced && last.run === run && last.type === type && last.key === ck[1]) {
      last.events.push(entry);
      last.joined += typeof event.delta === 'string' ? event.delta : '';
      paintRow(last);
      if (selected === last) paintEvent();
    } else {
      const r = { seq, t, run, type, events: [entry], coalesced: !!ck, keyName: ck && ck[0], key: ck && ck[1], joined: ck && typeof event.delta === 'string' ? event.delta : '' };
      const btn = el('button', 'dp-row fam-' + family(type));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      r.timeEl = el('span', 'dp-time');
      r.typeEl = el('span', 'dp-type');
      r.countEl = el('span', 'dp-count');
      r.sumEl = el('span', 'dp-sum');
      btn.append(r.timeEl, r.typeEl, r.countEl, r.sumEl);
      btn.addEventListener('click', () => selectRow(r));
      r.btn = btn;
      paintRow(r);
      rows.push(r);
      run.count++;
      run.rowsEl.appendChild(btn);
      dropOldest();
    }
    paintMeta();
    toBottom();
    if (tab === 'shape' && shapeNodeId != null && type === 'STATE_SNAPSHOT') paintShape();
  }

  /* init */
  selectTab('shape');
  paintMeta();
  paintShape();
  paintState(true);
  paintEvent();

  return {
    record,
    setState(s) {
      state = s;
      paintState(false);
      if (shapeNodeId != null) paintShape();
    },
    show({ nodeId } = {}) {
      if (nodeId != null) {
        shapeNodeId = nodeId;
        paintShape();
        selectTab('shape');
      } else {
        selectTab('state');
      }
      requestAnimationFrame(toBottom);
      toBottom();
    },
    onSurface(fn) { surfaceCb = fn; },
    focusFirst() { back.focus(); },
  };
}
