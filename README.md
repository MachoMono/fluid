# Fluid

An interface with no fixed shape. You say what you need; an agent decides the form, function and feel of the
surface, and the surface re-forms as your need changes. There are no apps, pages or menus.

The idea comes from the way classical Chinese philosophy uses water: it takes the shape of whatever holds it,
serves without competing, settles in the humblest place, and wears down what is rigid. The water here is a
design principle, not a visual theme.

## How it works

- The agent talks to the browser over [AG-UI](https://github.com/ag-ui-protocol/ag-ui) (`@ag-ui/client` on the web
  side, the Claude adapter `ag-ui-claude-sdk` on the agent side).
- The interface is **shared state**: the agent writes `ui` (a tree of nodes), `theme` and `memory` with the
  adapter's `ag_ui_update_state` tool. The web client renders whatever is in `ui`.
- Nodes keep stable ids, and the shell uses the View Transitions API so elements flow from one form to the next
  instead of jumping.
- For anything the node vocabulary cannot express, the agent can write a sandboxed mini-page (`html` node) that
  talks back through `postMessage`.
- Rest is the default: no `ui`, just a place to speak. Every earlier form can be flowed back to with Back.
- **Depth.** The AG-UI machinery is hidden by default. Dive under the surface to see the raw event stream, the shared
  state, and the spec of any part of the interface. Press Alt+D or use the Depth button for the whole surface,
  hold Alt and click a part to dive into just that part, or pinch in on a trackpad. Esc, the "Back to the surface"
  button, or pinching out brings you back. The zoom can be reversed at any moment.

## Run it

You need `uv`, Node 20+, and the `claude` CLI logged in. No API key is used: the agent runs on your Claude login
through the Claude Agent SDK.

```bash
./start.sh        # agent on 127.0.0.1:8020, web on http://127.0.0.1:5173
```

The agent can search the web and nothing else (no files, no shell). It listens on localhost only. It acts on your
Claude account, so do not expose the port.

## Layout

```
agent/server.py        the agent and the prompt that defines the node vocabulary
web/src/main.js        shell: AG-UI connection, morphing, history, voice input, dive wiring
web/src/dive.js        the zoom between the surface and the depths (Web Animations, reversible)
web/src/inspector.js   the depth view: event stream, shared state, node spec
web/src/render.js      renders the agent's node tree safely (style whitelist, sandboxed html)
web/src/components.css theme variables and component styles
```
