// Fluid shell: connects to the agent over AG-UI, renders whatever shape the agent puts in shared state,
// morphs between shapes, and lets you dive under the surface to see the AG-UI events behind it.
import '@fontsource/zen-kaku-gothic-new/latin-300.css'
import '@fontsource/zen-kaku-gothic-new/latin-400.css'
import '@fontsource/zen-kaku-gothic-new/latin-500.css'
import '@fontsource/zen-kaku-gothic-new/latin-700.css'
import { HttpAgent } from '@ag-ui/client'
import { renderTree, applyTheme } from './render.js'
import { createInspector } from './inspector.js'
import { createDive } from './dive.js'
import { shelf, playbooks, work, runs, lines, suggestName, ago } from './shelf.js'
import { createAbove } from './above.js'
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

// Above the surface. Only one layer is open at a time; the surface underneath is never lost.
const rise = createRise({
  stage: $('stage'), above: $('above'), haze: $('haze'),
  onOpened: () => above.focusFirst(),
  onClosed: () => { returnFocus?.focus?.(); returnFocus = null; refreshSignal() },
})
const layered = () => dive.isOpen() || rise.isOpen()

async function openAbove() {
  if (layered()) return
  returnFocus = document.activeElement
  await refreshAbove()
  rise.open()
}
const closeAbove = () => rise.close()
function goUp() { if (dive.isOpen()) surface(); else if (!rise.isOpen()) openAbove() }
function goDown() { if (rise.isOpen()) closeAbove(); else if (!dive.isOpen()) diveIn(null) }

async function refreshAbove() {
  const [needs, results] = await Promise.all([
    runs.list(true).catch(() => []),
    work.list().then((l) => l.filter((w) => w.status !== 'done')).catch(() => []),
  ])
  above.refresh({ needs, results })
}

// A quiet mark on the Above button whenever something is waiting on the person.
async function refreshSignal() {
  const needs = await runs.list(true).catch(() => [])
  $('up').classList.toggle('signal', needs.length > 0)
}

const above = createAbove($('above'), {
  onSurface: closeAbove,
  onWork: async (id) => { closeAbove(); await showWorkItem(id) },
  onRun: async (r) => {
    closeAbove()
    if (r.status === 'failed') { whisper(`“${r.playbook}” failed${r.note ? `: ${r.note}` : ''}.`); await runs.patch(r.id, { dismissed: true }).catch(() => {}); refreshSignal(); return }
    if (activeRun?.id === r.id) return                   // the run is still on the surface: just come back down to it
    await runs.patch(r.id, { dismissed: true }).catch(() => {})   // it belonged to an earlier session: start it again
    refreshSignal()
    if (r.playbook_id) runPlaybook({ id: r.playbook_id })
  },
  onDismiss: async (id) => { await runs.patch(id, { dismissed: true }).catch(() => {}); refreshAbove(); refreshSignal() },
})

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
  onStateChanged({ state }) { if (state) adopt(state) },
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
function place(ui) {
  const next = { ...agent.state, ui, theme: agent.state?.theme ?? {} }
  agent.state = next
  adopt(next)
}

const fieldValue = (name) => values[name] ?? document.querySelector(`#surface [data-name="${name}"]`)?.value ?? ''

async function showWorkItem(id) {
  try {
    const w = await work.get(id)
    const done = w.status === 'done'
    place({ id: 'wk', type: 'stack', gap: 18, children: [
      { id: 'wk-h', type: 'heading', level: 1, text: w.title },
      { id: 'wk-m', type: 'text', tone: 'quiet', text: [w.playbook || w.kind, ago(w.made), done ? 'done' : 'open'].filter(Boolean).join(' · ') },
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
      whisper(`Saved “${saved.title}” to Work. It is waiting above the surface.`)
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
    } else if (action === 'fluid:open-work') await showWorkItem(payload?.id)
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
$('rest').addEventListener('click', clear)
$('depth').addEventListener('click', () => diveIn(null))
$('up').addEventListener('click', () => (rise.isOpen() ? closeAbove() : openAbove()))

// Tone: stone (default) or blue water. A personal preference, kept in the browser, applied before first paint.
function setTone(tone) {
  const apply = () => {
    if (tone === 'blue') root.dataset.tone = 'blue'; else delete root.dataset.tone
    $('tone').setAttribute('aria-pressed', String(tone === 'blue'))
    store.set('fluid:tone', tone)
  }
  if (!reduceMotion() && document.startViewTransition && !dive.isOpen()) {
    root.classList.add('tone-switching')
    document.startViewTransition(apply).finished.finally(() => root.classList.remove('tone-switching'))
  } else apply()
}
$('tone').setAttribute('aria-pressed', String(root.dataset.tone === 'blue'))
$('tone').addEventListener('click', () => setTone(root.dataset.tone === 'blue' ? 'stone' : 'blue'))

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

function renderShelf() {
  const ul = $('suggest')
  // Kept forms and playbooks share one list. A playbook never run yet sits on top; after that, most recent first.
  const items = [
    ...kept.map((f) => ({ type: 'form', id: f.id, name: f.name, when: f.kept })),
    ...plays.map((p) => ({ type: 'playbook', id: p.id, name: p.name, when: p.last_run || '9999' })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1))
  ul.classList.toggle('kept', items.length > 0)
  if (!items.length) {
    ul.replaceChildren(...suggestions.map((s) => {
      const li = el('li'), b = el('button', '', s)
      b.type = 'button'
      b.addEventListener('click', () => { if (!running) send(s) })
      li.append(b)
      return li
    }))
    return
  }
  ul.replaceChildren(...items.slice(0, 6).map((f) => {
    const li = el('li')
    const open = el('button', 'kept-open', f.name); open.type = 'button'
    open.addEventListener('click', () => (f.type === 'playbook' ? runPlaybook(f) : openKept(f)))
    const date = el('span', f.type === 'playbook' ? 'kept-date kept-run' : 'kept-date', f.type === 'playbook' ? 'Run' : ago(f.when))
    const rm = el('button', 'kept-remove', 'Remove'); rm.type = 'button'
    let armed = 0
    rm.addEventListener('click', async () => {
      if (!armed) {                                   // first press asks, second press removes
        rm.textContent = 'Remove it?'
        armed = setTimeout(() => { rm.textContent = 'Remove'; armed = 0 }, 3500)
        return
      }
      clearTimeout(armed)
      try {
        await (f.type === 'playbook' ? playbooks.remove(f.id) : shelf.remove(f.id))
        li.classList.add('leaving')
        await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 290))
        await refreshShelf(); whisper(`Removed “${f.name}”.`)
      } catch (e) { whisper(e.message) }
    })
    rm.addEventListener('blur', () => { clearTimeout(armed); armed = 0; rm.textContent = 'Remove' })
    li.append(open, date, rm)
    return li
  }))
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
  if (e.key === 'Escape' && dive.isOpen()) { e.preventDefault(); surface() }
  else if (e.key === 'Escape' && rise.isOpen()) { e.preventDefault(); closeAbove() }
  else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); goUp() }
  else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); goDown() }
  else if (e.altKey && e.code === 'KeyD') { e.preventDefault(); if (rise.isOpen()) closeAbove(); else if (dive.isOpen()) surface(); else diveIn(null) }
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
    if (rise.isOpen()) closeAbove()
    else if (!dive.isOpen()) diveIn(document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#surface *'))
  } else if (pinch > 70) {                // pinching out goes up
    pinch = 0
    goUp()
  }
}, { passive: false })

// Optional voice input where the browser supports it.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
if (Rec) {
  const mic = $('mic'); mic.hidden = false
  const rec = new Rec(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true
  let listening = false
  rec.onresult = (e) => { $('say').value = [...e.results].map((r) => r[0].transcript).join('') }
  rec.onend = () => {
    listening = false; mic.classList.remove('on'); mic.textContent = 'Speak'
    const t = $('say').value.trim()
    if (t && !running) { $('say').value = ''; send(t) }
  }
  rec.onerror = () => { listening = false; mic.classList.remove('on'); mic.textContent = 'Speak' }
  mic.addEventListener('click', () => {
    if (listening) rec.stop()
    else { listening = true; mic.classList.add('on'); mic.textContent = 'Listening'; rec.start() }
  })
}

inspector.setState(agent.state ?? saved)
show(saved.ui ?? null, saved.theme ?? {})
refreshShelf()
refreshSignal()
