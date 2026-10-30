// Fluid shell: connects to the agent over AG-UI, renders whatever shape the agent puts in shared state,
// morphs between shapes, and lets you dive under the surface to see the AG-UI events behind it.
import '@fontsource/zen-kaku-gothic-new/latin-300.css'
import '@fontsource/zen-kaku-gothic-new/latin-400.css'
import '@fontsource/zen-kaku-gothic-new/latin-500.css'
import '@fontsource/zen-kaku-gothic-new/latin-700.css'
import { HttpAgent } from '@ag-ui/client'
import { renderTree, applyTheme, setIframeFontCss } from './render.js'
import { loadFontCss } from './fonts.js'
import { createInspector } from './inspector.js'
import { createDive } from './dive.js'
import { shelf, playbooks, work, runs, profile, lines, suggestName, ago } from './shelf.js'
import { createHorizon } from './horizon.js'
import { renderShelfInto } from './shelfview.js'
import { createRise } from './rise.js'
import './components.css'
import './shell.css'

const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://127.0.0.1:8020/fluid'
const $ = (id) => document.getElementById(id)
const root = document.documentElement
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode: run without persistence */ } },
}

const blank = { ui: null, theme: {}, memory: '' }
let saved = blank
// Version 2 of the saved state. Earlier versions could carry a dark theme from before light became the default, and
// the agent keeps whatever theme it is handed, so those are dropped rather than migrated.
const STATE_KEY = 'fluid:state:2', THREAD_KEY = 'fluid:thread:2'
try { localStorage.removeItem('fluid:state'); localStorage.removeItem('fluid:thread') } catch { /* nothing to clean */ }
try { saved = { ...blank, ...JSON.parse(store.get(STATE_KEY) || '{}') } } catch { saved = blank }
const threadId = store.get(THREAD_KEY) || crypto.randomUUID()
store.set(THREAD_KEY, threadId)

const agent = new HttpAgent({ url: AGENT_URL, threadId, initialState: saved })

let current = JSON.stringify({ ui: saved.ui, theme: saved.theme })
const history = []          // earlier forms the person can flow back to
let running = false
let pendingEvent = null     // one interaction queued while the agent is mid-run
const values = {}           // live values of the agent's input fields

// ---- the depths: the AG-UI view under the surface ------------------------------------------------------

const inspector = createInspector($('depths'))
const dive = createDive({
  stage: $('stage'), depths: $('depths'), veil: $('veil'),
  onOpened: () => inspector.focusFirst(),
  onClosed: () => { returnFocus?.focus?.(); returnFocus = null },
})
let returnFocus = null

// The Horizon. Only one layer is open at a time; the surface underneath is never lost.
const rise = createRise({
  stage: $('stage'), horizon: $('horizon'), haze: $('haze'),
  onOpened: () => horizon.focusFirst(),
  onClosed: () => { (returnFocus?.isConnected ? returnFocus : $('say'))?.focus?.(); returnFocus = null; refreshSignal() },
})
const layered = () => dive.isOpen() || rise.isOpen()

async function openHorizon() {
  if (layered()) return
  returnFocus = document.activeElement
  await refreshHorizon()
  rise.open()
}
const closeHorizon = () => rise.close()
function goUp() { if (dive.isOpen()) surface(); else if (!rise.isOpen()) openHorizon() }
function goDown() { if (rise.isOpen()) closeHorizon(); else if (!dive.isOpen()) diveIn(null) }

async function refreshHorizon() {
  const [needs, results] = await Promise.all([
    runs.list(true).catch(() => []),
    work.list().then((l) => l.filter((w) => w.status !== 'done')).catch(() => []),
  ])
  const who = await profile.get().catch(() => ({ name: '' }))
  const line = needs.length === 1 ? `${needs[0].playbook} needs you.`
    : needs.length ? `${needs.length} things need you.`
    : results.length === 1 ? 'One arrival is waiting.'
    : results.length ? `${results.length} arrivals are waiting.`
    : 'Nothing needs you. Let’s make something.'
  horizon.refresh({ needs, results, items: shelfItems(), name: who.name, line })
}

// A quiet mark on the Horizon button whenever something is waiting on the person.
async function refreshSignal() {
  const needs = await runs.list(true).catch(() => [])
  $('up').classList.toggle('signal', needs.length > 0)
}

const horizon = createHorizon($('horizon'), {
  onDown: closeHorizon,
  onAsk: (text) => { closeHorizon(); send(text) },
  shelf: {
    onOpen: async (f) => { if (f.type === 'playbook') { closeHorizon(); runPlaybook(f) } else { await openKept(f); closeHorizon() } },
    onSuggest: (t) => { closeHorizon(); send(t) },
    remove: (f) => (f.type === 'playbook' ? playbooks.remove(f.id) : shelf.remove(f.id)),
    refresh: () => refreshShelf(),
    notify: (t) => whisper(t),
    calm: reduceMotion,
  },
  // Each item is placed on the surface while the Horizon is still open, so it is already there when you come down.
  onWork: async (id) => { await showWorkItem(id); closeHorizon() },
  onRun: async (r) => {
    if (r.status !== 'failed' && activeRun?.id === r.id && runSurface?.runId === r.id) {
      place(runSurface.ui, runSurface.theme)             // still running: bring its own surface back
    } else {
      placeRunNote(r)                                    // failed, or left over from an earlier session
      runs.patch(r.id, { dismissed: true }).then(refreshSignal).catch(() => {})
    }
    closeHorizon()
  },
  onDismiss: async (id) => { await runs.patch(id, { dismissed: true }).catch(() => {}); refreshHorizon(); refreshSignal() },
})

// What a failed or interrupted run shows when you open it: what happened, and a way to start again.
function placeRunNote(r) {
  const failed = r.status === 'failed'
  place({ id: 'run-note', type: 'stack', gap: 18, children: [
    { id: 'rn-h', type: 'heading', level: 1, text: failed ? `${r.playbook} did not finish` : `${r.playbook} was interrupted` },
    { id: 'rn-t', type: 'text', tone: 'quiet', text: failed ? (r.note || 'It stopped with an error.') : 'The page was reloaded while it waited for you, so it could not pick up where it left off.' },
    ...(r.playbook_id ? [{ id: 'rn-b', type: 'button', label: 'Run it again', variant: 'primary', action: 'fluid:rerun', payload: { id: r.playbook_id } }] : []),
  ] })
}

function diveIn(el) {
  if (layered()) return
  returnFocus = document.activeElement
  const nodeEl = el?.closest?.('[data-id]')
  inspector.setState(agent.state)
  inspector.show(nodeEl ? { nodeId: nodeEl.dataset.id } : {})
  dive.open(nodeEl ? nodeEl.getBoundingClientRect() : null)
}
const surface = () => dive.close()
inspector.onSurface(surface)

// ---- morphing -------------------------------------------------------------------------------------------

// Every change of surface flows: new parts rise out of the waterline one after another, parts that stay glide to
// their new place, parts that go sink away. The browser does the morph; the shell only sets the order.
let staggerStyle = null
const shown = (id) => getComputedStyle($(id)).display !== 'none'
const partNames = () => [
  ...(shown('still') ? ['still'] : []),
  ...[...$('surface').querySelectorAll('[data-id]')].map((e) => e.style.viewTransitionName).filter(Boolean),
  ...(shown('below') ? ['below'] : []),
]

function stagger(before, after) {
  const had = new Set(before), has = new Set(after)
  const leaving = before.filter((n) => !has.has(n))
  const wait = leaving.length ? 300 : 100          // new parts begin as the old ones clear, so the two never crowd each other
  const rules = [
    ...after.filter((n) => !had.has(n)).map((n, i) => `::view-transition-new(${n}):only-child{animation-delay:${wait + Math.min(i * 45, 450)}ms !important}`),
    ...leaving.map((n, i) => `::view-transition-old(${n}):only-child{animation-delay:${Math.min(i * 20, 120)}ms !important}`),
  ]
  staggerStyle?.remove()
  staggerStyle = Object.assign(document.createElement('style'), { textContent: rules.join('\n') })
  document.head.append(staggerStyle)
}

function show(ui, theme) {
  const before = partNames()
  const run = () => {
    applyTheme(root, theme || {})
    renderTree($('surface'), ui, api)
    document.body.classList.toggle('resting', !ui)
    syncKeep()
  }
  if (!reduceMotion() && !layered()) {
    if (document.startViewTransition) {
      const t = document.startViewTransition(() => { run(); stagger(before, partNames()) })
      t.finished.finally(() => { staggerStyle?.remove(); staggerStyle = null })
    } else {                                    // no view transitions in this browser: a plain rise
      run()
      $('surface').animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
        { duration: 600, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' })
    }
  } else run()                                  // reduced motion, or the depths are open and nothing visible would move
}

function persist(state) {
  store.set(STATE_KEY, JSON.stringify({ ui: state.ui ?? null, theme: state.theme ?? {}, memory: state.memory ?? '' }))
}

function mirrorRun(state) {
  const r = state.run
  if (!activeRun || !r || typeof r !== 'object') return
  const sig = JSON.stringify([r.status, r.step, r.note])
  if (sig === runSig) return
  runSig = sig
  const status = ['working', 'waiting', 'done', 'failed'].includes(r.status) ? r.status : 'working'
  runs.patch(activeRun.id, { status, step: String(r.step ?? '').slice(0, 120), note: String(r.note ?? '').slice(0, 300) })
    .then(refreshSignal).catch(() => {})
}

function adopt(state, { remember = true } = {}) {
  mirrorRun(state)
  inspector.setState(state)
  const next = JSON.stringify({ ui: state.ui ?? null, theme: state.theme ?? {} })
  if (next === current) { persist(state); return }
  if (remember) { history.push(current); if (history.length > 30) history.shift() }
  current = next
  $('back').disabled = history.length === 0
  show(state.ui ?? null, state.theme ?? {})
  persist(state)
}

function flowBack() {
  const prev = history.pop()
  if (prev === undefined) return
  const { ui, theme } = JSON.parse(prev)
  current = prev
  agent.state = { ...agent.state, ui, theme }   // the agent sees the form we returned to
  inspector.setState(agent.state)
  $('back').disabled = history.length === 0
  show(ui, theme)
  persist(agent.state)
}

function clear() {
  adopt({ ...agent.state, ui: null })
  agent.state = { ...agent.state, ui: null }
}

// ---- the waterline: level at rest, a slow swell while the agent works ----------------------------------

const waterline = (() => {
  const path = $('line-path')
  const W = 1000, MID = 12, STEPS = 80
  let amp = 0, goal = 0, phase = 0, raf = 0
  const draw = () => {
    let d = `M0 ${MID}`
    for (let i = 1; i <= STEPS; i++) {
      const x = (i / STEPS) * W
      const y = MID + amp * Math.sin(phase + (i / STEPS) * Math.PI * 3.2) * Math.sin((i / STEPS) * Math.PI)
      d += ` L${x.toFixed(1)} ${y.toFixed(2)}`
    }
    path.setAttribute('d', d)
  }
  const tick = () => {
    amp += (goal - amp) * 0.045
    phase += 0.05 * (0.4 + amp / 5)
    if (goal === 0 && amp < 0.03) { amp = 0; path.setAttribute('d', `M0 ${MID} H${W}`); raf = 0; return }
    draw()
    raf = requestAnimationFrame(tick)
  }
  return {
    swell() { if (reduceMotion()) return; goal = 5; if (!raf) raf = requestAnimationFrame(tick) },
    settle() { goal = 0; if (!raf && amp > 0) raf = requestAnimationFrame(tick) },
  }
})()

// ---- talking to the agent -------------------------------------------------------------------------------

let whisperTimer = null
function whisper(text) {
  const el = $('whisper')
  el.textContent = text
  el.classList.toggle('on', !!text)
  clearTimeout(whisperTimer)
  if (text) whisperTimer = setTimeout(() => el.classList.remove('on'), 9000)
}

function setRunning(on) {
  running = on
  document.body.classList.toggle('flowing', on)
  $('go').hidden = on
  $('stop').hidden = !on
  on ? waterline.swell() : waterline.settle()
}

function failRun(note) {
  if (!activeRun) return
  runs.patch(activeRun.id, { status: 'failed', note: String(note).slice(0, 300) }).then(refreshSignal).catch(() => {})
  activeRun = null
}

let spoken = ''
const subscriber = {
  onEvent({ event }) { inspector.record(event) },
  onRunStartedEvent() { spoken = ''; whisper('') },
  onTextMessageContentEvent({ event }) { spoken += event.delta; whisper(spoken) },
  onStateChanged({ state }) {
    if (!state) return
    if (activeRun && state.run && state.ui) runSurface = { runId: activeRun.id, ui: state.ui, theme: state.theme }
    adopt(state)
  },
  onRunFailed({ error }) { whisper(`Could not reach the agent: ${error?.message || error}`); failRun(error?.message || String(error)) },
  onRunErrorEvent({ event }) { whisper(event.message); failRun(event.message) },
}

async function send(text) {
  if (running) return false
  agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
  setRunning(true)
  try { await agent.runAgent({}, subscriber) }
  catch (e) { if (e?.name !== 'AbortError') whisper(`Could not reach the agent: ${e.message}`) }
  finally {
    setRunning(false)
    if (pendingEvent) { const t = pendingEvent; pendingEvent = null; send(t) }
  }
  return true
}

// Interactions inside the agent's surface come back as [ui-event] messages.
const api = {
  values,
  onValue() {},
  onAction(action, payload) {
    if (typeof action === 'string' && action.startsWith('fluid:')) { localAction(action, payload); return }
    const text = `[ui-event] ${JSON.stringify({ action, payload, values })}`
    if (running) pendingEvent = text
    else send(text)
  },
}

// ---- playbooks and work ---------------------------------------------------------------------------------
// Playbooks are files; the shell loads one into the agent only when you run it. The agent proposes, you approve:
// results and playbooks are saved by the shell when you press the button, never by the agent.

let activePlaybook = ''   // name of the playbook being run, recorded on the work item it produces
let activeRun = null      // the run record for it, kept current from the agent's `run` state
let runSig = ''
let runSurface = null     // the last surface the agent drew for that run, so it can be brought back

async function runPlaybook(p) {
  if (running) return
  try {
    const pb = await playbooks.get(p.id)
    activePlaybook = pb.name
    activeRun = await runs.create(pb.name, p.id).catch(() => null)
    runSig = ''
    playbooks.ran(p.id).then(refreshShelf).catch(() => {})
    send(`[fluid:run-playbook]\n${pb.text}`)
  } catch (e) { whisper(e.message) }
}

function draftPlaybook(nameHint) {
  if (running) return
  send(`[fluid:draft-playbook] Suggested name: ${nameHint || 'none'}`)
}

// Put a surface built here, not by the agent, on screen; the agent sees it as the current state.
function place(ui, theme) {
  const next = { ...agent.state, ui, theme: theme ?? agent.state?.theme ?? {} }
  agent.state = next
  adopt(next)
}

const fieldValue = (name) => values[name] ?? document.querySelector(`#surface [data-name="${name}"]`)?.value ?? ''

async function showWorkItem(id) {
  try {
    const w = await work.get(id)
    const done = w.status === 'done'
    place({ id: 'wk', type: 'stack', gap: 28, children: [
      { id: 'wk-top', type: 'stack', gap: 10, children: [
        { id: 'wk-h', type: 'heading', level: 1, text: w.title },
        { id: 'wk-m', type: 'text', tone: 'quiet', text: [w.playbook || w.kind, ago(w.made), done ? 'done' : ''].filter(Boolean).join(' · ') },
      ] },
      { id: 'wk-b', type: 'markdown', text: w.body },
      { id: 'wk-s', type: 'button', label: done ? 'Reopen' : 'Mark done', variant: done ? 'quiet' : 'primary',
        action: 'fluid:work-status', payload: { id: w.id, status: done ? 'open' : 'done' } },
    ] })
  } catch (e) { whisper(e.message) }
}

async function localAction(action, payload) {
  try {
    if (action === 'fluid:save-work') {
      const w = agent.state?.work
      if (!w?.title || !w?.body) { whisper('There is nothing to save yet.'); return }
      const saved = await work.create({ title: String(w.title), kind: String(w.kind || 'note'), body: String(w.body), playbook: activePlaybook })
      agent.state = { ...agent.state, work: null }
      if (activeRun) { runs.patch(activeRun.id, { status: 'done', work_id: saved.id, note: '' }).catch(() => {}); activeRun = null }
      whisper(`Saved “${saved.title}” to Work. It is waiting on the Horizon.`)
      refreshSignal()
    } else if (action === 'fluid:save-playbook') {
      const name = fieldValue('pb_name').trim()
      if (!name) { whisper('Give the playbook a name first.'); return }
      const saved = await playbooks.create({
        name, purpose: fieldValue('pb_purpose').trim(), ask: lines(fieldValue('pb_ask')), steps: lines(fieldValue('pb_steps')),
        approvals: lines(fieldValue('pb_approvals')), result: fieldValue('pb_result').trim(),
      })
      await refreshShelf()
      whisper(`Saved the playbook “${saved.name}”. It is on the main screen.`)
    } else if (action === 'fluid:rerun') await runPlaybook({ id: payload?.id })
    else if (action === 'fluid:open-work') await showWorkItem(payload?.id)
    else if (action === 'fluid:work-status') { await work.status(payload.id, payload.status); await showWorkItem(payload.id) }
  } catch (e) { whisper(e.message) }
}

// ---- shell controls -------------------------------------------------------------------------------------

$('intent').addEventListener('submit', (e) => {
  e.preventDefault()
  const t = $('say').value.trim()
  if (!t || running) return
  $('say').value = ''
  send(t)
})
$('stop').addEventListener('click', () => agent.abortRun())
$('back').addEventListener('click', flowBack)
$('rest').addEventListener('click', () => { clear(); openHorizon() })
$('depth').addEventListener('click', () => diveIn(null))
$('up').addEventListener('click', () => (rise.isOpen() ? closeHorizon() : openHorizon()))

// Tone: stone (default) or blue water. A personal preference, kept in the browser, applied before first paint.
function setTone(tone) {
  const apply = () => {
    if (tone === 'blue') root.dataset.tone = 'blue'; else delete root.dataset.tone
    syncTone()
    store.set('fluid:tone', tone)
  }
  if (!reduceMotion() && document.startViewTransition && !dive.isOpen()) {
    root.classList.add('tone-switching')
    document.startViewTransition(apply).finished.finally(() => root.classList.remove('tone-switching'))
  } else apply()
}
// One tone control, fixed in the corner above every layer.
const syncTone = () => document.querySelectorAll('.tone-toggle').forEach((b) => b.setAttribute('aria-pressed', String(root.dataset.tone === 'blue')))
syncTone()
document.querySelectorAll('.tone-toggle').forEach((b) => b.addEventListener('click', () => setTone(root.dataset.tone === 'blue' ? 'stone' : 'blue')))

// ---- the shelf: forms you kept. Plain names under the line at rest; suggestions only while the shelf is empty ----

const suggestions = ['A calm focus timer', 'Plan a week in Lisbon', 'Teach me the circle of fifths', 'Think through a decision with me']
let kept = []             // [{id, name, kept}] newest first
let plays = []            // [{id, name, purpose, last_run}]
let keptSig = null        // signature of the form that was just kept, so the button can say Kept

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

// Kept forms and playbooks share one list. A playbook never run yet sits on top; after that, most recent first.
function shelfItems() {
  return [
    ...kept.map((f) => ({ type: 'form', id: f.id, name: f.name, when: f.kept })),
    ...plays.map((p) => ({ type: 'playbook', id: p.id, name: p.name, when: p.last_run || '9999' })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1))
}

function renderShelf() {
  renderShelfInto($('suggest'), shelfItems(), {
    onOpen: (f) => (f.type === 'playbook' ? runPlaybook(f) : openKept(f)),
    onSuggest: (t) => { if (!running) send(t) },
    remove: (f) => (f.type === 'playbook' ? playbooks.remove(f.id) : shelf.remove(f.id)),
    refresh: () => refreshShelf(),
    notify: (t) => whisper(t),
    calm: reduceMotion,
  }, suggestions)
  if (rise.isOpen()) refreshHorizon()
}

async function refreshShelf() {
  // Agent not running: the shelf simply stays empty, and nothing on disk is touched.
  ;[kept, plays] = await Promise.all([shelf.list().catch(() => []), playbooks.list().catch(() => [])])
  renderShelf()
}

async function openKept(f) {
  if (running) return
  try {
    const form = await shelf.open(f.id)
    const next = { ...agent.state, ui: form.ui, theme: form.theme || {} }
    agent.state = next
    adopt(next)
    keptSig = current                                  // it is already on the shelf
    syncKeep()
    whisper(`Opened “${form.name}”.`)
  } catch (e) { whisper(e.message) }
}

// Keep appears only when there is something to keep, and asks for a name right where the whisper sits.
function syncKeep() {
  const has = !document.body.classList.contains('resting')
  const btn = $('keep')
  btn.hidden = !has || !$('keepform').hidden
  const already = has && keptSig === current
  btn.textContent = already ? 'Kept' : 'Keep'
  btn.disabled = already
  if (!has) closeKeep()
}
function openKeep() {
  const s = JSON.parse(current)
  $('keepname').value = suggestName(s.ui, s.theme)
  $('keepform').hidden = false
  $('keep').hidden = true
  $('whisper').hidden = true
  $('keepname').focus(); $('keepname').select()
}
function closeKeep({ refocus = false } = {}) {
  if ($('keepform').hidden) return
  $('keepform').hidden = true
  $('whisper').hidden = false
  syncKeep()
  if (refocus) $('keep').focus()
}
$('keep').addEventListener('click', openKeep)
$('keepcancel').addEventListener('click', () => closeKeep({ refocus: true }))
$('keeprepeat').addEventListener('click', () => { const n = $('keepname').value.trim(); closeKeep(); draftPlaybook(n) })
$('keepname').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeKeep({ refocus: true }) } })
$('keepform').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('keepname').value.trim()
  if (!name) return
  const { ui, theme } = JSON.parse(current)
  if (!ui) return
  try {
    const saved = await shelf.keep(name, ui, theme)
    keptSig = current
    closeKeep()
    await refreshShelf()
    whisper(`Kept as “${saved.name}”.`)
  } catch (err) { whisper(err.message) }
})

// ---- going deeper: Alt+D, Alt+click on a part, pinch in; Esc or pinch out to come back ------------------

addEventListener('keydown', (e) => {
  // On the Horizon, typing anywhere starts a request: the line takes focus and the key lands in it.
  if (rise.isOpen() && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) horizon.focusFirst()
  if (e.key === 'Escape' && dive.isOpen()) { e.preventDefault(); surface() }
  else if (e.key === 'Escape' && rise.isOpen()) { e.preventDefault(); closeHorizon() }
  else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); goUp() }
  else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); goDown() }
  else if (e.altKey && e.code === 'KeyD') { e.preventDefault(); if (rise.isOpen()) closeHorizon(); else if (dive.isOpen()) surface(); else diveIn(null) }
  else if (e.key === 'Alt' && !layered()) document.body.classList.add('lens')
})
const dropLens = () => { document.body.classList.remove('lens'); document.querySelector('.lens-target')?.classList.remove('lens-target') }
addEventListener('keyup', (e) => { if (e.key === 'Alt') dropLens() })
addEventListener('blur', dropLens)

$('surface').addEventListener('pointermove', (e) => {
  if (!document.body.classList.contains('lens')) return
  const el = e.target.closest?.('[data-id]')
  const prev = document.querySelector('.lens-target')
  if (prev === el) return
  prev?.classList.remove('lens-target')
  el?.classList.add('lens-target')
})
$('surface').addEventListener('click', (e) => {
  if (!e.altKey) return
  e.preventDefault(); e.stopPropagation()
  dropLens()
  diveIn(e.target)
}, true)

// A trackpad pinch arrives as ctrl+wheel. Gather it, and past a threshold take the dive.
let pinch = 0, pinchTimer = 0
addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return
  e.preventDefault()
  pinch += e.deltaY
  clearTimeout(pinchTimer)
  pinchTimer = setTimeout(() => { pinch = 0 }, 260)
  if (pinch < -70) {                      // pinching in goes down: toward the depths, or back to the surface from above
    pinch = 0
    if (rise.isOpen()) closeHorizon()
    else if (!dive.isOpen()) diveIn(document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#surface *'))
  } else if (pinch > 70) {                // pinching out goes up
    pinch = 0
    goUp()
  }
}, { passive: false })

// Optional voice input where the browser supports it. The same behaviour serves Flow's line and the Horizon's.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
function attachVoice(mic, input, onFinal) {
  if (!Rec) return
  mic.hidden = false
  const rec = new Rec(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true
  let listening = false
  const idle = () => { listening = false; mic.classList.remove('on'); mic.textContent = 'Speak' }
  rec.onresult = (e) => { input.value = [...e.results].map((r) => r[0].transcript).join('') }
  rec.onend = () => { idle(); const t = input.value.trim(); if (t && !running) { input.value = ''; onFinal(t) } }
  rec.onerror = idle
  mic.addEventListener('click', () => {
    if (listening) rec.stop()
    else { listening = true; mic.classList.add('on'); mic.textContent = 'Listening'; rec.start() }
  })
}
attachVoice($('mic'), $('say'), send)
attachVoice(document.getElementById('hz-mic'), document.getElementById('hz-say'), (t) => { closeHorizon(); send(t) })

inspector.setState(agent.state ?? saved)
show(saved.ui ?? null, saved.theme ?? {})
refreshShelf()
refreshSignal()

// The app opens on the Horizon. Whatever was on the surface last time is still there, one step down in Flow.
refreshHorizon().finally(() => { rise.openInstant(); root.classList.add('ready') })
loadFontCss().then(setIframeFontCss).catch(() => {})   // mini-pages fall back to the system font if this fails
