// The shelf client: forms the person chose to keep, stored by the agent server as plain files in ~/Fluid.
const BASE = new URL(import.meta.env.VITE_AGENT_URL || 'http://127.0.0.1:8020/fluid').origin

async function call(path, init) {
  const res = await fetch(BASE + path, init)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Shelf error ${res.status}`)
  return res.json()
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const shelf = {
  list: () => call('/shelf'),
  open: (id) => call(`/shelf/${encodeURIComponent(id)}`),
  keep: (name, ui, theme) => call('/shelf', json('POST', { name, ui, theme })),
  remove: (id) => call(`/shelf/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

const enc = encodeURIComponent
const post = (path) => call(path, { method: 'POST' })   // no body: the browser still sends its Origin header

// Playbooks: repeatable processes, stored as markdown files in ~/Fluid/playbooks.
export const playbooks = {
  list: () => call('/playbooks'),
  get: (id) => call(`/playbooks/${enc(id)}`),
  create: (p) => call('/playbooks', json('POST', p)),
  ran: (id) => post(`/playbooks/${enc(id)}/ran`),
  remove: (id) => call(`/playbooks/${enc(id)}`, { method: 'DELETE' }),
}

// Work: what runs produce, stored as markdown files in ~/Fluid/work.
export const work = {
  list: () => call('/work'),
  get: (id) => call(`/work/${enc(id)}`),
  create: (w) => call('/work', json('POST', w)),
  status: (id, status) => call(`/work/${enc(id)}`, json('PATCH', { status })),
}

export const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

// A name to offer when keeping: the title the agent gave the surface, else the first heading, else a plain fallback.
export function suggestName(ui, theme) {
  if (typeof theme?.title === 'string' && theme.title.trim()) return theme.title.trim()
  const seen = [ui]
  while (seen.length) {
    const n = seen.shift()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'heading' && typeof n.text === 'string' && n.text.trim()) return n.text.trim().slice(0, 60)
    if (Array.isArray(n.children)) seen.push(...n.children)
  }
  return 'Untitled form'
}

const rtf = new Intl.RelativeTimeFormat(navigator.language || 'en', { numeric: 'auto' })
export function ago(iso) {
  const t = Date.parse(iso)
  if (!t) return ''
  const s = (t - Date.now()) / 1000
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  }
  return 'just now'
}
