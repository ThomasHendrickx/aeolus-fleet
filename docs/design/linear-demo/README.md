# Linear demo

Design step for [#1228](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1228), following the [hosted onboarding design](../hosted-onboarding/README.md) ([#1925](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1925)). The purpose and all five decisions are approved. The demo belongs to the marketing site.

Status: purpose approved; Q1, Q3, Q4 and Q5 accepted as written, Q2 decided for the marketing site (Thomas, 17 Nov). Detailed screens await clarification from orchestrator-1.

## 1. Purpose

A person deciding whether Aeolus is for them sees, in a few minutes and with nothing installed, what it will be like for someone like them: they go from screen to screen, or action to action, through one path to its first value, in screens that look and feel like the product, with nothing real behind them.

Thomas, on dropping slice 12 of the onboarding design (the live demo asking a lone Decider a question): "The demo how it is made today is not really that useful if we look at it. How we solved this in [another product] is to have UI linear demos of someone going from screen to screen or action to action and sees how it should work. It looks and feels real, but is totally fake with no real backend. That feels like the better solution here than to start making changes to our product for a demo that misses its purpose."

Who it is for:

- **A Decider alone** (path D2): nobody has added them yet. They see an agent's question reach them, answer it, and see the work go on with their answer; then what to send a builder (D1).
- **A Flow owner** (path F1): before connecting anything, they see one flow with an app, an agent and a person, and where each hand-off shows.
- **A Builder** weighing whether to start: they see what a path's first value looks like (an agent asking them, two agents handing work over, a steering ship building a ship) before they install anything.
- **The person's own agent**, guiding from `/start`: it can send the person to the demo of the path they picked, to see it before they do it.

What it replaces: the live demo, a real read-only fleet with scripted ships kept running by the hosted app's demo runner and opened with a viewer ticket, and the onboarding design's Q4 pick (a per-visit demo question on that fleet, slice 12), dropped by Thomas.

Not the purpose: a sandbox to try the product in; teaching every screen of the console; product changes made for the demo; self-hosting; metrics.

## 2. Lessons to check against

### Today's live demo, and why it misses

| # | Lesson | Source |
| --- | --- | --- |
| L1 | The live demo is a real fleet: a runner builds it, crews scripted ships on its own computer, keeps a squadron at work and rebuilds it every night at 03:00 UTC, retrying when a part is down | the hosted app's demo runner |
| L2 | A visitor signs in as the viewer with a viewer ticket and sees the console read-only, under a viewers' notice ("a live demo fleet with scripted ships ... read-only") and a 9-step guide of console pages | [0022](../../decisions/0022-viewer-ship.md), [0023](../../decisions/0023-notices.md), [0024](../../decisions/0024-guide.md) |
| L3 | It shows a fleet, not a person's path: no step is the visitor's own action, nothing reaches a first value, and its operator inbox holds questions the visitor cannot answer | [walk](../hosted-onboarding/walk.md) D2; onboarding S10 |
| L4 | Making it ask the visitor a question needs changes to the runner and the viewer ticket: changing the product for a demo. Thomas dropped that (slice 12) | onboarding Q4, slice 12 |
| L5 | It has real running costs: a server, core, squadrons and the trierarch plugin up for it, a fleet per installation, nightly rebuilds; staging has none, so it is seen only on production | the hosted app's demo runner; walk |
| L6 | The viewer ship and viewer tickets are core features in their own right, kept by decision; retiring the demo does not retire them | [0050](../../decisions/0050-domain-language.md) ("the viewer stays") |

### The onboarding design

| # | Lesson | Source |
| --- | --- | --- |
| L7 | People pick what to try; value differs per persona. The linear, single-file journey for a company was rejected. A linear demo is linear inside one path, never across personas | onboarding purpose, L2 |
| L8 | Personas Builder, Decider, Flow owner, and each path's first value and next path, are decided; a demo shows those, it invents none | onboarding section 4 |
| L9 | The site picker and `/start` come from one source; llms.txt never names a page that is not built | onboarding picks 1 and 4, L9 |
| L10 | A Decider coming alone: a real fleet when a builder invites them, the demo as fallback | onboarding pick 3 |
| L11 | One meaning per term, the Words page's; persona, path and first value are the onboarding purpose's words | [0050](../../decisions/0050-domain-language.md) |
| L12 | Before 1.0.0, keep designs minimal; no polish for zero customers | [0013](../../decisions/README.md) |
| L13 | The approved onboarding mockups already show the screens each path crosses, in the ui package's look | [mockups](../hosted-onboarding/mockups/coverage.md) |

### The linear-demo pattern Thomas points at

The pattern, described generically:

| # | Lesson |
| --- | --- |
| L14 | Each demo is one named flow at its own public address, a list of flows on an index page, with no sign-in and no app shell; a closing card offers the next step (sign up, another flow, back to the site) |
| L15 | A flow is data: an ordered list of steps. Each step is one screen, a short narrative (title and text) pointing at one element of it, and what moves it on: the visitor clicking the element, a handler being called, a typing animation finishing, a Next button, or a timeout |
| L16 | Screens are of two kinds: the product's real views, fed fabricated seed data through a thin demo container that routes their actions into "next step" (no API calls, no writes, no analytics); and simulated surfaces for what is not the product (a phone, a mail inbox, a notification, a chat) |
| L17 | The narrative sits over the screen without hiding it: a focused card for the first steps, then a small marker beside the element so the visitor can act on the screen itself |
| L18 | The step logic is pure and unit-tested; each demo screen and the narrative parts have stories |
| L19 | It reuses the product's real views because they are props-only; where a view was not, the demo shows a simulated one rather than change the product for it |

## 3. Decisions

### Q1. Which paths get a demo

1. **One per path**: B1, B2, B3, B4, D2 and F1, each to its first value.
2. **One per persona**: a Decider answers an agent's question (D2); a Flow owner sees one flow's hand-offs (F1); a Builder watches a steering ship build a ship that hands work back (B4).
3. **Only the Decider's** (D2), the one path with no first value alone.

Decided: 2. Each persona gets the first value it cannot reach without signing up or being added, and the Builder sees the big path, where Aeolus is hardest to imagine; B1 to B3 are quick to do for real. Option 1 is six flows to keep up for zero customers (L12); option 3 leaves a Flow owner with no way to see the flow before connecting one.

### Q2. Where it lives

Decided: **the marketing site**, next to the picker and the docs. Thomas: "Why 'runs on staging'??? This demo is marketing website .." The demo needs no staging, hosted app, sign-in or fleet. Its screens compose the ui package's real parts with fabricated data, as Q3 decides. The site and `/start` link to the marketing site's demo flows.

### Q3. Which real parts it renders

1. **The ui package's parts**, with demo screens built from them in the look of the approved onboarding mockups (L13), and simulated surfaces for the agent's terminal, a chat and the mail.
2. **The product's real screens** (fleet overview, ship page, Bridge's question), made props-only and exported for the demo.
3. **Pictures**: the mockups' previews, clickable.

Decided: 1. It looks and feels real with no product change (Thomas: no "changes to our product for a demo"); a screen that later moves into the ui package for its own reasons, such as the questions UI ([0043](../../decisions/0043-core-surface.md)), is then used as it is. Option 2 changes core, the console and the gateway for the demo; option 3 does not feel real and cannot be acted on.

### Q4. What happens to the live demo and its runner

1. **Retire both when the linear demo ships**: the hosted app's demo runner, the demo fleet, its viewer ticket route, notice and guide go; the marketing site serves the linear demo and the site and `/start` point there. The viewer ship, viewer tickets, notices and guides stay in core (L6).
2. **Keep both**, the live fleet as "see a real fleet" beside the linear demo.
3. **Retire both now**, before the linear demo ships.

Decided: 1. Thomas finds it "not really that useful"; it costs a running fleet (L5) and two demos to keep up. Option 3 leaves the site's and `/start`'s demo links dead until then.

### Q5. What path D2 becomes

1. **D2 is the Decider's demo**: they answer the question in the demo and see the work go on; the first value is seen, not real, and the closing card says what to send a builder (D1).
2. **D2 goes**: a Decider alone is sent to ask a builder; the demo only shows.

Decided: 1. It keeps onboarding pick 3 (the demo as the lone Decider's fallback, L10) with what Thomas asked for, and ends at the real next path. Option 2 leaves a lone Decider with nothing to do.
