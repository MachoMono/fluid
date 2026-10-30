// Above the surface: where results arrive and anything that needs the person shows up. Fixed, glanceable layout;
// the only things that vary are the words. Empty means all is well.
import './above.css'
import { ago } from './shelf.js'

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export function createAbove(mount, { onSurface, onWork, onRun, onDismiss }) {
  mount.classList.add('above-root')

  const back = el('button', 'ab-back')
  back.type = 'button'
  back.append(el('span', '', 'Back to the surface'), el('kbd', '', 'Esc'))
  back.addEventListener('click', onSurface)

  const body = el('div', 'ab-body')
  mount.append(back, body)

  const section = (title, rows) => {
    const s = el('section', 'ab-section')
    s.append(el('h2', 'ab-title', title), ...rows)
    return s
  }

  const row = (title, sub, onPress, onClear) => {
    const r = el('div', 'ab-row')
    const open = el('button', 'ab-open')
    open.type = 'button'
    open.append(el('span', 'ab-name', title), el('span', 'ab-sub', sub))
    open.addEventListener('click', onPress)
    r.append(open)
    if (onClear) {
      const x = el('button', 'ab-clear', 'Dismiss')
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
    // needs: runs waiting on the person or failed; results: open work items
    refresh({ needs = [], results = [] }) {
      const parts = []
      if (needs.length) {
        parts.push(section('Needs you', needs.map((r) => row(r.playbook, describe(r), () => onRun(r), () => onDismiss(r.id)))))
      }
      if (results.length) {
        parts.push(section('Results', results.map((w) => row(w.title, `${w.playbook || w.kind} · ${ago(w.made)}`, () => onWork(w.id)))))
      }
      if (!parts.length) {
        const calm = el('div', 'ab-calm')
        calm.append(el('p', 'ab-calm-line', 'Nothing needs you.'), el('p', 'ab-calm-sub', 'Results from your playbooks arrive here.'))
        parts.push(calm)
      }
      body.replaceChildren(...parts)
    },
    focusFirst() { back.focus() },
  }
}
