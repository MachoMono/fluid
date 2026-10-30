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
import { shelf, suggestName, ago } from './shelf.js'
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
  if (!reduceMotion() && !dive.isOpen()) {
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

// ---- the shelf: forms you kept. Plain names under the line at rest; suggestions only while the shelf is empty ----

const suggestions = ['A calm focus timer', 'Plan a week in Lisbon', 'Teach me the circle of fifths', 'Think through a decision with me']
let kept = []             // [{id, name, kept}] newest first
let keptSig = null        // signature of the form that was just kept, so the button can say Kept

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function renderShelf() {
  const ul = $('suggest')
  ul.classList.toggle('kept', kept.length > 0)
  if (!kept.length) {
    ul.replaceChildren(...suggestions.map((s) => {
      const li = el('li'), b = el('button', '', s)
      b.type = 'button'
      b.addEventListener('click', () => { if (!running) send(s) })
      li.append(b)
      return li
    }))
    return
  }
  ul.replaceChildren(...kept.slice(0, 6).map((f) => {
    const li = el('li')
    const open = el('button', 'kept-open', f.name); open.type = 'button'
    open.addEventListener('click', () => openKept(f))
    const date = el('span', 'kept-date', ago(f.kept))
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
        await shelf.remove(f.id)
        li.classList.add('leaving')
        await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 290))
        await refreshShelf(); whisper(`Removed “${f.name}”.`)
      }
      catch (e) { whisper(e.message) }
    })
    rm.addEventListener('blur', () => { clearTimeout(armed); armed = 0; rm.textContent = 'Remove' })
    li.append(open, date, rm)
    return li
  }))
}

async function refreshShelf() {
  try { kept = await shelf.list() } catch { kept = [] }   // agent not running: the shelf simply stays empty
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
refreshShelf()
