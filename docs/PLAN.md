# Fluid: plan

Fluid is a local operating surface for one person and their agent. The interface has no fixed shape: the agent
forms whatever the person needs, and the repeatable parts of their work become playbooks that climb toward
running on their own, with the person approving and reviewing along the way. It runs on one machine, for one
person, on their own Claude login.

The guiding image is water: it takes the shape of whatever holds it, serves without competing, and wears a channel
by repeating itself. A playbook is that channel.

## Principles

- **Quiet by default.** Home is a question and a line to speak into. Nothing is shown that is not needed.
- **Agentic is the goal, the human is always in the loop on the way there.** Autonomy is earned per playbook and only
  the person grants it.
- **The agent proposes, the person saves.** The agent has no file access. Saving, approving and promoting are the
  person's button presses.
- **Plain files on the person's machine.** Everything durable is readable markdown or JSON under `~/Fluid`.
- **Nothing cuts.** Every change of view flows. One animation language across the whole app.
- **Light and airy.** Stone by default, blue water as a tone. Dark only on request.

## Three layers, one vertical axis

```
Horizon  home: ask, see what needs you, what was produced, and your playbooks  (glance, start)
-------- the waterline
Flow     talk to the agent, shape things, tweak a playbook                      (build)
Depth    the AG-UI events, shared state and the spec of any part                (inspect)
```

Adjacent layers only: Horizon and Depth are both one step from Flow. Moving up or down is one gesture family
(buttons, Alt+Up / Alt+Down, pinch) with one reversible animation each way. What is in Flow is never lost
while you are above or below it. The app opens on the Horizon, and Clear returns to it.

**Horizon** holds two kinds of things, both tied to playbooks:
- *Needs you*: a run is waiting for approval, or failed. Temporary; act on it or dismiss it.
- *Results*: work items. Lasting until marked done.
When nothing needs the person, Horizon is nearly empty, and empty means all is well. Failures must always raise a
notification; silence must never hide a problem. Pressing an item drops into Flow with that thing already on screen.

## Objects

| Object | What it is | Where it lives |
| --- | --- | --- |
| Form | A kept surface, as it was | `~/Fluid/forms/*.json` |
| Playbook | A repeatable process: ask, steps, approvals, result, level | `~/Fluid/playbooks/*.md` |
| Run | One execution of a playbook, with status and history | `~/Fluid/runs/*.json` |
| Work item | What a run produced | `~/Fluid/work/*.md` |
| Profile | What the companion learned about the person's job | `~/Fluid/profile.md` |

## Autonomy ladder

Each playbook has a level. The agent may propose a promotion with evidence; only the person promotes.

1. **Draft**: the agent describes the process, the person does it.
2. **Assisted**: the agent does the steps, the person approves each.
3. **Supervised**: the agent runs it and stops only at the steps marked as gates.
4. **Agentic**: it runs on its trigger, the person reviews results afterward.

Evidence comes from run history, for example "approved eight times with no edits." Anything irreversible or
outward-facing (sending, deleting, spending, credentials) stays gated until released by name. The trigger is always
set by the person: manual first, then schedules they create.

## The companion agent

A built-in playbook, "Get to know my work", is the first thing that ships. It interviews the person in short
rounds, writes `profile.md`, ranks candidate playbooks by how often the task repeats and how much time it costs,
and drafts them through the same "make repeatable" path the person already uses. It proposes only what the OS can
actually do today and marks the rest "needs X", using a small capability list the OS maintains. New playbooks start
at level 1 or 2. Re-running it later updates what exists.

It may delegate to subagents: research on the person's role, drafting candidates in parallel, a separate reviewer
for each draft (never the builder), and a dry run of a draft on sample input. The person sees one calm agent; the
workers appear in the Depth view. A cap on concurrent workers keeps usage predictable. To verify before relying on
it: how the AG-UI adapter reports subagent activity.

## Security (local, single user)

The server listens on localhost only, rejects changes from any other origin, and validates every file name. The agent
has no file, shell or network tools beyond web search. The port must never be exposed, because it acts on the
person's Claude account. Mini-pages the agent writes run in a sandbox with no network.

## Phases

1. **Horizon.** The third layer and the rise to it. Run records. Needs-you notifications from manual runs. Work
   moves up. The Horizon button signals when something needs the person.
2. **The companion.** `profile.md`, the capability list, the interview playbook, subagent support.
3. **Levels.** Level and gate fields on playbooks, evidence from run history, promotion proposals as notifications.
4. **The runner.** A background process that runs playbooks on schedules the person sets, an approvals queue,
   usage limits, and notifications when the app is closed.

## Decided

- Local, single user. One `~/Fluid` folder.
- Playbooks and work items are markdown; runs and forms are JSON.
- Triggers are set by the person. Manual first.
- Horizon is a fixed, glanceable layout; the agent writes only the words in it.

## Open

- The Horizon's greeting and status line are fixed templates for now. Once the companion exists and knows the person,
  it should write that line, in the same calm voice.
- How subagent activity is reported through the AG-UI adapter.
- Where a background runner lives (a service started with the app, or a system timer) and how it shows usage.
- Whether to keep full event logs per run, or only a summary and the notable events.
