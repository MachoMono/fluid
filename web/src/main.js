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
try { saved = { ...blank, ...JSON.parse(store.get('fluid:state') || '{}') } } catch { saved = blank }
const threadId = store.get('fluid:thread') || crypto.randomUUID()
store.set('fluid:thread', threadId)

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

function diveIn(el) {
  if (dive.isOpen()) return
  returnFocus = document.activeElement
  const nodeEl = el?.closest?.('[data-id]')
  inspector.setState(agent.state)
  inspector.show(nodeEl ? { nodeId: nodeEl.dataset.id } : {})
  dive.open(nodeEl ? nodeEl.getBoundingClientRect() : null)
}
const surface = () => dive.close()
inspector.onSurface(surface)

// ---- morphing -------------------------------------------------------------------------------------------

function show(ui, theme) {
  const run = () => {
    applyTheme(root, theme || {})
    renderTree($('surface'), ui, api)
    document.body.classList.toggle('resting', !ui)
  }
  // Skip the page-wide transition while the depths are open: nothing visible would morph, only the cost.
  if (document.startViewTransition && !reduceMotion() && !dive.isOpen()) document.startViewTransition(run)
  else run()
}

function persist(state) {
  store.set('fluid:state', JSON.stringify({ ui: state.ui ?? null, theme: state.theme ?? {}, memory: state.memory ?? '' }))
}

function adopt(state, { remember = true } = {}) {
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

let spoken = ''
const subscriber = {
  onEvent({ event }) { inspector.record(event) },
  onRunStartedEvent() { spoken = ''; whisper('') },
  onTextMessageContentEvent({ event }) { spoken += event.delta; whisper(spoken) },
  onStateChanged({ state }) { if (state) adopt(state) },
  onRunFailed({ error }) { whisper(`Could not reach the agent: ${error?.message || error}`) },
  onRunErrorEvent({ event }) { whisper(event.message) },
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
    const text = `[ui-event] ${JSON.stringify({ action, payload, values })}`
    if (running) pendingEvent = text
    else send(text)
  },
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

const suggestions = ['A calm focus timer', 'Plan a week in Lisbon', 'Teach me the circle of fifths', 'Think through a decision with me']
$('suggest').replaceChildren(...suggestions.map((s) => {
  const li = document.createElement('li')
  const b = document.createElement('button')
  b.type = 'button'; b.textContent = s
  b.addEventListener('click', () => { if (!running) send(s) })
  li.append(b)
  return li
}))

// ---- going deeper: Alt+D, Alt+click on a part, pinch in; Esc or pinch out to come back ------------------

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dive.isOpen()) { e.preventDefault(); surface() }
  else if (e.altKey && e.code === 'KeyD') { e.preventDefault(); dive.isOpen() ? surface() : diveIn(null) }
  else if (e.key === 'Alt' && !dive.isOpen()) document.body.classList.add('lens')
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
  if (pinch < -70 && !dive.isOpen()) { pinch = 0; diveIn(document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#surface *')) }
  else if (pinch > 70 && dive.isOpen()) { pinch = 0; surface() }
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
