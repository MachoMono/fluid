// The shelf list, shared by Flow's resting screen and the Horizon home: kept forms and playbooks as plain names, with
// the date (or "Run") giving way to Remove on hover. Remove asks twice. With nothing kept, it offers a few ideas.
import { ago } from './shelf.js'

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

// items: [{type: 'form' | 'playbook', id, name, when}]
// hooks: onOpen(item), onSuggest(text), remove(item) (does the deletion), refresh(), notify(text), calm() -> reduced motion?
export function renderShelfInto(ul, items, hooks, suggestions = []) {
  ul.classList.toggle('kept', items.length > 0)
  if (!items.length) {
    ul.replaceChildren(...suggestions.map((s) => {
      const li = el('li'), b = el('button', '', s)
      b.type = 'button'
      b.addEventListener('click', () => hooks.onSuggest(s))
      li.append(b)
      return li
    }))
    return
  }
  ul.replaceChildren(...items.slice(0, 6).map((f) => {
    const li = el('li')
    const open = el('button', 'kept-open', f.name); open.type = 'button'
    open.addEventListener('click', () => hooks.onOpen(f))
    const meta = el('span', f.type === 'playbook' ? 'kept-date kept-run' : 'kept-date', f.type === 'playbook' ? 'Run' : ago(f.when))
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
        await hooks.remove(f)
        li.classList.add('leaving')
        await new Promise((r) => setTimeout(r, hooks.calm() ? 0 : 290))
        await hooks.refresh()
        hooks.notify(`Removed “${f.name}”.`)
      } catch (e) { hooks.notify(e.message) }
    })
    rm.addEventListener('blur', () => { clearTimeout(armed); armed = 0; rm.textContent = 'Remove' })
    li.append(open, meta, rm)
    return li
  }))
}
