# Fluid

An interface with no fixed shape. You say what you need; an agent decides the form, function and feel of the
screen, and it re-forms as your need changes. There are no apps, pages or menus.

The idea comes from the way classical Chinese philosophy uses water: it takes the shape of whatever holds it,
serves without competing, settles in the humblest place, and wears down what is rigid. The water here is a
design principle, not a visual theme.

## How it works

- The agent talks to the browser over [AG-UI](https://github.com/ag-ui-protocol/ag-ui) (`@ag-ui/client` on the web
  side, the Claude adapter `ag-ui-claude-sdk` on the agent side).
- The interface is **shared state**: the agent writes `ui` (a tree of nodes), `theme` and `memory` with the
  adapter's `ag_ui_update_state` tool. The web client renders whatever is in `ui`.
- Nodes keep stable ids. Nothing ever cuts: parts that stay glide to their new place, new parts rise out of the
  waterline one after another, and parts that go sink away (View Transitions API, with a plain fade as fallback).
- For anything the node vocabulary cannot express, the agent can write a sandboxed mini-page (`html` node) that
  talks back through `postMessage`.
- The app opens on the **Horizon**: a greeting, what needs you, your arrivals, and your playbooks and kept forms.
  Typing there drops you into **Flow**, where the agent shapes things with you. Clear returns home. Every earlier
  form can be flowed back to with Back.
- **Depth.** The AG-UI machinery is hidden by default. Dive under the surface to see the raw event stream, the shared
  state, and the spec of any part of the interface. Press Alt+D or use the Depth button for all of Flow,
  hold Alt and click a part to dive into just that part, or pinch in on a trackpad. Esc, the "Back to Flow"
  button, or pinching out brings you back. Alt+Up goes up to the Horizon. The zoom can be reversed at any moment.

## Run it

You need `uv`, Node 20+, and the `claude` CLI logged in. No API key is used: the agent runs on your Claude login
through the Claude Agent SDK.

```bash
./start.sh        # agent on 127.0.0.1:8020, web on http://127.0.0.1:5173
```

The agent can search the web and nothing else (no files, no shell). It listens on localhost only. It acts on your
Claude account, so do not expose the port.

## The gauge and tone

A quiet strip on the right edge shows which layer you are in (Horizon, Flow, Depth) and moves you between them. Below the
marks are the tone control and a book that explains the layers.

The water-level circle in the gauge on the right edge, the same on every layer, switches the whole interface to a soft water blue (the Depth view with
it). It is a personal preference, kept in the browser, and it overrides whatever palette the agent chose. Press it
again to return to the stone default.

## Keeping things

- **Keep** saves the current form to `~/Fluid/forms/` as one readable JSON file. At rest, your kept forms appear
  under the line and open instantly, with no agent run. Remove asks twice before it deletes.
- The agent never reads the harbor, so keeping things adds nothing to its context.
- Set `FLUID_HOME` to keep the folder somewhere else.

## Playbooks and work

- A **playbook** is a repeatable process stored as a readable markdown file in `~/Fluid/playbooks/`: what to ask,
  the steps, where to stop for your approval, and what each run produces. A Weekly review comes as an example
  (`agent/examples/weekly-review.md`).
- **Make repeatable** (offered when you press Keep) has the agent draft a playbook from what you just did. You edit
  the draft in Flow and save it. Nothing runs by itself: the trigger is you pressing the playbook on the
  main screen.
- Running a playbook loads only that playbook into the agent. It asks for its inputs, does the steps, stops at
  approval points, and ends with a result. The agent proposes, and the shell saves the result when you press
  the button. The agent has no file access.
- What a run produces is an **arrival**: a work item, saved as a markdown file in `~/Fluid/work/` that says which
  playbook made it. Arrivals appear on the Horizon, and each can be marked done.

## Layout

```
agent/server.py        the agent and the prompt that defines the node vocabulary
agent/shelf.py         the harbor: kept forms as plain files in ~/Fluid
agent/playbooks.py     playbooks as markdown files; agent/work.py holds work items; agent/fsutil.py shared helpers
web/src/main.js        shell: AG-UI connection, morphing, history, voice input, dive wiring
web/src/dive.js        the zoom between Flow and Depth (Web Animations, reversible)
web/src/inspector.js   the depth view: event stream, shared state, node spec
web/src/shelf.js       client for the harbor
web/src/render.js      renders the agent's node tree safely (style whitelist, sandboxed html)
web/src/components.css theme variables and component styles
```
