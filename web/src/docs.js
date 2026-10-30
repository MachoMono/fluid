// The orientation text: Fluid's own vocabulary, explained in a few quiet lines. Used inline on the Horizon for someone
// new, and in the gauge's book card for everyone else.
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export function buildDocs() {
  const root = el('div', 'hz-docs')
  const grid = el('div', 'hz-layers')
  for (const [name, text, keys] of [
    ['Horizon', 'Home. See what needs you and what has arrived, and set out on something from your harbor.', 'Alt ↑ from Flow'],
    ['Flow', 'Where you and the agent make things together. Say what you want and the screen takes shape.', 'Alt ↓ from Horizon'],
    ['Depth', 'Beneath it all. The live events and state behind anything you see.', 'Alt ↓ from Flow'],
  ]) {
    const c = el('div', 'hz-layer')
    c.append(el('h3', '', name), el('p', '', text), el('span', 'hz-keys', keys))
    grid.append(c)
  }
  const terms = el('p', 'hz-terms')
  terms.append(el('b', '', 'Playbook'), ' is a process you can run again. ', el('b', '', 'Arrivals'), ' are what a run produces. Your ',
    el('b', '', 'harbor'), ' holds playbooks and anything you keep.')
  root.append(grid, terms)
  return root
}
