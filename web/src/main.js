// Fluid shell: connects to the agent over AG-UI, renders whatever shape the agent puts in shared state,
// and morphs between shapes. The shell itself stays minimal: one surface, one line to speak into.
import { HttpAgent } from '@ag-ui/client'
import { renderTree, applyTheme } from './render.js'
import './components.css'
import './shell.css'

const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://127.0.0.1:8020/fluid'
const $ = (id) => document.getElementById(id)
const root = document.documentElement
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

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

// ---- morphing -------------------------------------------------------------------------------------------

function show(ui, theme) {
  const run = () => {
    applyTheme(root, theme || {})
    renderTree($('surface'), ui, api)
    document.body.classList.toggle('resting', !ui)
  }
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(run)
  else run()
}

function adopt(state, { remember = true } = {}) {
  const next = JSON.stringify({ ui: state.ui ?? null, theme: state.theme ?? {} })
  if (next === current) return
  if (remember) { history.push(current); if (history.length > 30) history.shift() }
  current = next
  $('back').disabled = history.length === 0
  show(state.ui ?? null, state.theme ?? {})
  store.set('fluid:state', JSON.stringify({ ui: state.ui ?? null, theme: state.theme ?? {}, memory: state.memory ?? '' }))
}

function flowBack() {
  const prev = history.pop()
  if (prev === undefined) return
  const { ui, theme } = JSON.parse(prev)
  current = prev
  agent.state = { ...agent.state, ui, theme }   // the agent sees the form we returned to
  $('back').disabled = history.length === 0
  show(ui, theme)
  store.set('fluid:state', JSON.stringify({ ...agent.state, ui, theme }))
}

function rest() {
  adopt({ ...agent.state, ui: null })
  agent.state = { ...agent.state, ui: null }
}

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
}

let spoken = ''
const subscriber = {
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
$('rest').addEventListener('click', rest)

const suggestions = ['a calm focus timer', 'plan a week in Lisbon', 'teach me the circle of fifths', 'a place to think through a decision']
$('suggest').replaceChildren(...suggestions.map((s) => {
  const b = document.createElement('button')
  b.type = 'button'; b.textContent = s
  b.addEventListener('click', () => { if (!running) send(s) })
  return b
}))

// Optional voice input where the browser supports it.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
if (Rec) {
  const mic = $('mic'); mic.hidden = false
  const rec = new Rec(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true
  let listening = false
  rec.onresult = (e) => { $('say').value = [...e.results].map((r) => r[0].transcript).join('') }
  rec.onend = () => {
    listening = false; mic.classList.remove('on')
    const t = $('say').value.trim()
    if (t && !running) { $('say').value = ''; send(t) }
  }
  rec.onerror = () => { listening = false; mic.classList.remove('on') }
  mic.addEventListener('click', () => { if (listening) rec.stop(); else { listening = true; mic.classList.add('on'); rec.start() } })
}

show(saved.ui ?? null, saved.theme ?? {})
