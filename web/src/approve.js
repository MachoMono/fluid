// The approval card. The agent has no shell: it proposes one command in shared state, and this card, owned by the shell,
// shows that exact text. Nothing runs unless the person presses Run.
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export function createApprover({ onRun, onCancel }) {
  const card = el('div', 'approve')
  card.id = 'approve'; card.hidden = true; card.tabIndex = -1
  card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-labelledby', 'approve-title'); card.setAttribute('aria-describedby', 'approve-cmd')
  const title = el('h2', 'ap-title', 'Run this command?'); title.id = 'approve-title'
  const why = el('p', 'ap-why')
  const cmd = el('pre', 'ap-cmd'); cmd.id = 'approve-cmd'
  const where = el('p', 'ap-where')
  const actions = el('div', 'ap-actions')
  const run = el('button', 'ap-run', 'Run'); run.type = 'button'
  const cancel = el('button', 'ap-cancel', 'Cancel'); cancel.type = 'button'
  actions.append(run, cancel)
  card.append(title, why, cmd, where, actions)
  document.body.append(card)

  let current = null
  const hide = () => { card.hidden = true; current = null }
  run.addEventListener('click', () => { const c = current; hide(); if (c) onRun(c) })
  cancel.addEventListener('click', () => { const c = current; hide(); if (c) onCancel(c) })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) { e.stopPropagation(); cancel.click() }
  }, true)

  return {
    show(c) {
      current = { cmd: String(c.cmd), why: String(c.why || ''), cwd: String(c.cwd || '') }
      why.textContent = current.why
      why.hidden = !current.why
      cmd.textContent = current.cmd                       // exactly what will run, as text
      where.textContent = current.cwd ? `in ${current.cwd}` : 'in your Fluid folder'
      card.hidden = false
      card.focus()
    },
    hide,
  }
}
