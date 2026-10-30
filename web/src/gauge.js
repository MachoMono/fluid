// The depth gauge: a quiet strip on the right edge, above every layer. Three marks show which layer you are in
// (Horizon, the waterline, Flow, Depth) and move you between them; below them sit the tone control and the book of
// orientation. One place, the same on every layer.
import './gauge.css'
import { buildDocs } from './docs.js'

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

const WATER_LEVEL = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <defs>
    <clipPath id="wl-clip"><circle cx="12" cy="12" r="9.2"/></clipPath>
    <linearGradient id="wl-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fc2ec"/><stop offset="1" stop-color="#3a8cc4"/></linearGradient>
  </defs>
  <g clip-path="url(#wl-clip)"><g class="wl-level"><path class="wl-wave" d="M-16 12q4-3 8 0t8 0 8 0 8 0 8 0 8 0V30H-16z" fill="url(#wl-water)"/></g></g>
  <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.5"/>
</svg>`
const BOOK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 6.6C10.4 5.3 8.1 4.7 4.5 5v12c3.6-.3 5.9.3 7.5 1.6 1.6-1.3 3.9-1.9 7.5-1.6V5c-3.6-.3-5.9.3-7.5 1.6zM12 6.6v12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const LAYERS = [['horizon', 'Horizon', 'Alt ↑'], ['flow', 'Flow', ''], ['depth', 'Depth', 'Alt ↓']]

export function createGauge(mount, { onGo }) {
  const marks = {}
  const layers = el('div', 'g-layers')
  LAYERS.forEach(([id, name, keys], i) => {
    if (i === 1) layers.append(el('span', 'g-waterline'))            // the waterline sits between Horizon and Flow
    const b = el('button', 'g-mark')
    b.type = 'button'; b.dataset.label = keys ? `${name}  ${keys}` : name; b.setAttribute('aria-label', name)
    b.append(el('span', 'g-dot'))
    b.addEventListener('click', () => onGo(id))
    marks[id] = b
    layers.append(b)
  })

  const tools = el('div', 'g-tools')
  const tone = el('button', 'g-tool tone-toggle')
  tone.type = 'button'; tone.dataset.label = 'Blue water'; tone.setAttribute('aria-label', 'Blue water tone'); tone.setAttribute('aria-pressed', 'false')
  tone.innerHTML = WATER_LEVEL
  const docs = el('button', 'g-tool g-docs')
  docs.type = 'button'; docs.dataset.label = 'How Fluid works'; docs.setAttribute('aria-label', 'How Fluid works'); docs.setAttribute('aria-expanded', 'false')
  docs.innerHTML = BOOK
  tools.append(tone, docs)
  mount.append(layers, tools)

  // The book opens a quiet card beside the gauge.
  const pop = el('div', 'g-pop')
  pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'How Fluid works')
  pop.append(buildDocs())
  document.body.append(pop)
  const close = () => { pop.hidden = true; docs.setAttribute('aria-expanded', 'false') }
  docs.addEventListener('click', () => {
    const open = pop.hidden
    pop.hidden = !open
    docs.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !docs.contains(e.target)) close() })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); docs.focus() }
  }, true)

  return {
    setLayer(id) {
      for (const [k, b] of Object.entries(marks)) {
        if (k === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current')
      }
    },
  }
}
