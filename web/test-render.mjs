// Browser-free sanity test with a minimal fake DOM. Run: node web/test-render.mjs
import assert from 'node:assert';
const mk = (tag) => {
  const el = { tag, style: { setProperty() {}, removeProperty() {} }, children: [], attrs: {}, listeners: {}, className: '', _t: '' };
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => el.attrs[k] ?? null;
  el.removeAttribute = (k) => { delete el.attrs[k]; };
  el.append = (...c) => { el.children.push(...c); };
  el.replaceChildren = (...c) => { el.children = c; };
  el.addEventListener = (e, f) => { el.listeners[e] = f; };
  el.contains = () => false;
  el.querySelectorAll = () => [];
  Object.defineProperty(el, 'textContent', { get: () => el._t + el.children.map((c) => c.textContent).join(''), set: (v) => { el._t = v; el.children = []; } });
  return el;
};
globalThis.document = { createElement: mk, createElementNS: (_, t) => mk(t), activeElement: null, title: '' };
const { renderTree, applyTheme, markdownToHtml } = await import('./src/render.js');

const actions = [];
const api = { values: {}, onAction: (a, p) => actions.push([a, p]) };
const root = mk('div');
renderTree(root, {
  id: 'r', type: 'stack', style: { color: 'red', background: 'url(x)', bogus: '1' }, children: [
    { id: 'h', type: 'heading', text: 'Hi' },
    { id: 'b', type: 'button', label: 'Go', action: 'go', payload: 1 },
    { id: 'i', type: 'input', name: 'q', label: 'Q', value: 'a' },
    { id: 'c', type: 'chart', kind: 'donut', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] },
    { id: 'x', type: 'weird' }, 5, null, { id: 'b', type: 'text', text: 'dup' },
  ],
}, api);
const top = root.children[0];
assert.equal(top.style.color, 'red');
assert.equal(top.style.background, undefined);
assert.equal(top.style.bogus, undefined);
assert.equal(top.children.length, 6);
assert.equal(top.children[4].textContent, '[weird]');
assert.equal(api.values.q, 'a');
top.children[1].listeners.click();
assert.deepEqual(actions[0], ['go', 1]);
assert.ok(!markdownToHtml('<script>x</script> [a](http://e.com) [b](https://e.com)').includes('<script'));
assert.ok(!markdownToHtml('[a](http://e.com)').includes('href'));
renderTree(root, null, api);
assert.equal(root.children.length, 0);
applyTheme(mk('div'), { mode: 'dark', radius: 4, title: 'T' });
assert.equal(document.title, 'T');
console.log('ok');
