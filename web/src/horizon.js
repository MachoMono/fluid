// The Horizon: home. Ask for something, see what needs you and what has arrived, and start a playbook or open
// something you kept. Fixed, glanceable layout; the only things that vary are the words. Calm when all is well.
import './horizon.css'
import { ago } from './shelf.js'
import { renderShelfInto } from './shelfview.js'
import { buildDocs } from './docs.js'

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

// handlers: onDown(), onAsk(text), onWork(id), onRun(run), onDismiss(runId)
// shelf: hooks for renderShelfInto, plus suggestions
export function createHorizon(mount, { onDown, onAsk, onWork, onRun, onDismiss, shelf, suggestions }) {
  mount.classList.add('horizon-root')

  const down = el('button', 'hz-down')
  down.type = 'button'
  down.append(el('span', '', 'Open Flow'), el('kbd', '', 'Alt ↓'))
  down.addEventListener('click', onDown)

  // A greeting, a calm line about where things stand, a level line, and a line to speak into. The input stays quiet
  // until it is used, and "Flow ↵" appears only once there is something to send.
  const hero = el('div', 'hz-hero')
  const greeting = el('h1', 'hz-greeting')
  const status = el('p', 'hz-status')
  const form = el('form', 'hz-ask')
  form.autocomplete = 'off'
  const field = el('div', 'hz-field')
  const say = el('input', 'hz-say')
  say.type = 'text'; say.id = 'hz-say'
  const narrow = matchMedia('(max-width: 560px)')
  const wording = () => { say.placeholder = narrow.matches ? 'Type to begin' : 'Type here to continue in Flow' }
  wording(); narrow.addEventListener('change', wording)
  say.setAttribute('aria-label', 'Say what you need, to continue in Flow')
  field.append(say)
  const mic = el('button', 'hz-mic', 'Speak'); mic.type = 'button'; mic.hidden = true; mic.id = 'hz-mic'
  const go = el('button', 'hz-go', 'Flow ↵'); go.type = 'submit'; go.setAttribute('aria-label', 'Continue in Flow')
  form.append(field, mic, go)
  say.addEventListener('input', () => form.classList.toggle('has', say.value.trim().length > 0))
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const t = say.value.trim()
    if (!t) return
    say.value = ''
    form.classList.remove('has')
    onAsk(t)
  })
  hero.append(greeting, status, form)

  const hello = (name) => {
    const h = new Date().getHours()
    const part = h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
    return name ? `${part}, ${name}.` : `${part}.`
  }

  const body = el('div', 'hz-body')
  const shelfList = el('ul', 'hz-shelf shelf-list')
  shelfList.id = 'hz-shelf'
  const top = el('div', 'hz-top')
  top.append(down)
  mount.append(top, hero, body)

  // New here? The vocabulary is Fluid's own, so it is explained in full until something is kept or has arrived. After that
  // the same text lives behind the book in the corner.
  const inlineDocs = buildDocs()

  const help = el('button', 'hz-help')
  help.type = 'button'; help.hidden = true; help.setAttribute('aria-label', 'How Fluid works'); help.setAttribute('aria-expanded', 'false')
  help.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M12 6.6C10.4 5.3 8.1 4.7 4.5 5v12c3.6-.3 5.9.3 7.5 1.6 1.6-1.3 3.9-1.9 7.5-1.6V5c-3.6-.3-5.9.3-7.5 1.6zM12 6.6v12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const pop = el('div', 'hz-pop'); pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'How Fluid works')
  pop.append(buildDocs())
  mount.append(help, pop)
  const closePop = () => { pop.hidden = true; help.setAttribute('aria-expanded', 'false') }
  help.addEventListener('click', () => {
    const open = pop.hidden
    pop.hidden = !open
    help.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== help && !help.contains(e.target)) closePop() })
  mount.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); closePop(); help.focus() } })

  const section = (title, rows) => {
    const s = el('section', 'hz-section')
    s.append(el('h2', 'hz-title', title), ...rows)
    return s
  }

  const row = (title, sub, onPress, onClear) => {
    const r = el('div', 'hz-row')
    const open = el('button', 'hz-open')
    open.type = 'button'
    open.append(el('span', 'hz-name', title), el('span', 'hz-sub', sub))
    open.addEventListener('click', onPress)
    r.append(open)
    if (onClear) {
      const x = el('button', 'hz-clear', 'Dismiss')
      x.type = 'button'
      x.addEventListener('click', onClear)
      r.append(x)
    }
    return r
  }

  const describe = (run) => {
    const what = run.status === 'failed' ? `Failed${run.note ? `: ${run.note}` : ''}` : (run.note || 'Waiting for your approval')
    return `${what} · ${ago(run.updated)}`
  }

  return {
    // needs: runs waiting on the person or failed; results: open work items; items: playbooks and kept forms
    refresh({ needs = [], results = [], items = [], name = '', line = '' }) {
      greeting.textContent = hello(name)
      status.textContent = line
      const parts = []
      if (needs.length) {
        parts.push(section('Needs you', needs.map((r) => row(r.playbook, describe(r), () => onRun(r), () => onDismiss(r.id)))))
      }
      if (results.length) {
        parts.push(section('Arrivals', results.map((w) => row(w.title, `${w.playbook || w.kind} · ${ago(w.made)}`, () => onWork(w.id)))))
      }
      if (items.length) {
        renderShelfInto(shelfList, items, shelf, [])
        parts.push(section('Harbor', [shelfList]))
      }
      const fresh = !needs.length && !results.length && !items.length
      if (fresh) parts.push(section('How Fluid works', [inlineDocs]))
      help.hidden = fresh
      if (fresh) closePop()
      body.replaceChildren(...parts)
    },
    attachMic() { return { mic, say } },
    focusFirst() { say.focus() },
  }
}
