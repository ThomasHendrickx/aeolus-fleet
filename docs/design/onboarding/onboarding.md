# Onboarding: getting into the fleet

Design for [#1228](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1228). Docs only: nothing here is built until Thomas approves it.

Status: stage 1 again, on the settled design system: the shared UI package in the Compact look ([ui-package](../ui-package/README.md), [its mockups](../ui-package/mockups/README.md)) and the Harbour fleet overview ([fleet-overview](../fleet-overview/README.md)). This file holds the purpose, the lessons and the questions (R1 to R7). Screens come in stage 2, once the purpose is agreed: a before and after mockup for each screen that changes, each approved by Thomas on its own. The journeys, independent of any screen, are in [journeys.md](journeys.md).

Thomas (25 Oct): "Since our main advantage now against the competition we identified is our focus on connecting technical to non technical people on a company, user friendlynes to get into the fleet should be flawless". Thomas (27 Oct): the onboarding goes hand in hand with the common design system. Thomas (31 Oct): "Restart onboarding design system".

## 1. Purpose (proposed, R1)

A new person in a company gets from "I was told to try Aeolus" to doing their part in the fleet without help, a guess, or someone who knows the insides. This is the hosted path: sign-up and sign-in by mailed link at the account app, the first fleet, the console, joining a computer, commissioning and crewing ships, and inviting colleagues who use the gateway.

What the restart adds to the purpose Thomas agreed on 27 Oct:
- **One product across three apps.** Getting in crosses the account app (pagasae), the console and the gateway. A newcomer moves between them by the shared header's app switcher and must meet one look, one set of parts and one way of saying what failed and what comes next. Every onboarding screen is drawn from `@aeolus-fleet/ui` in Compact; a part the onboarding needs and ui lacks is named, not drawn ad hoc.
- **Harbour is the first fleet view.** The console's fleet overview is Harbour. A new fleet's Harbour (argo, the founder's person ship, the plugin ships, no agent yet) says what the fleet still lacks and who can do it, from the fleet's own state.

For whom:
- **The founder**, non-technical, who signs up first and so is the first organisation admin and the fleet manager (0051).
- **Ada**, technical, who sets the fleet up, joins a computer and crews the first ship, alone or handed over by the founder.
- **The organisation admin**, who lets colleagues in with the rights their part needs.
- **Bea**, a non-technical colleague who is invited, answers ships and joins meetings, through the gateway or her own Claude or ChatGPT. Bea never sees a terminal.

The outcomes:
1. Ada goes from the sign-up mail to her first ship answering her message in one sitting, and at each screen sees what comes next. She never needs to know that argo, a scope or a harness exists to get there.
2. Ada invites Bea and the fleet is ready for Bea: what she was given works, with nothing Ada must ask the hosting service for.
3. Bea goes from the invite mail to her first answered question without meeting an id, JSON or a word nobody explained, and is told when something waits while she is away, the way she chose.
4. A step that fails or is interrupted says what happened, whether anything changed, and the next step. Nobody is stranded, and nobody needs argo's fail-safe (0012) to get past a normal step.
5. Moving from one app to the next, nobody can tell where one app ends: the same header, parts, words and states.
6. A new technical person and a new non-technical person, each walked on staging with no help, reach their first ship answering (Ada) and their first answered question (Bea).

Not the purpose:
- Building the ui package or its parts: [#1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206)'s slices U1 to U20. This design uses them and names what it needs from them.
- Harbour itself, the Compact look and the tokens: settled.
- A marketing site; listing Aeolus in the chat apps' directories ([#1214](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1214)); ships as Slack bots ([#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227)); Teams and the other channels of the research ([#1229](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1229)).
- Connecting Entra or Google for a company ([company-sign-in design](../accounts/company-sign-in.md)).
- Self-hosted installs (one person, as argo).

## 2. Lessons to check against

### 2.1 The audit's frictions, now

Source: the onboarding audit, [PR #1232](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1232), `docs/audits/onboarding-2026-10-25/README.md`, walked on staging at 0.31.0. Frictions F1 to F28 are numbered there. Status read from the issues on 31 Oct, not walked again.

| Status | Frictions |
| --- | --- |
| Fixed | F3 plugin install ([#1235](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1235)). F4 interrupted setup locks the ship ([#1236](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1236)). F7 gateway Overview scrolls sideways ([#1238](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1238)). F8 lost setup line: New setup line on the card ([#1239](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1239)). F9 mic arrival and the queue ([#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240)). F13 setup checks Claude Code and Node ([#1244](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1244)). F15 empty starting prompt ([#1246](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1246)). F18 stuck delivery after a join ([#1249](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1249)). F19 disabled Connect without a reason ([#1250](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1250)). The renamed plugin after an upgrade ([#1312](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1312)) |
| Not planned | F11 email off by default. Thomas (28 Oct): "off by default or it is a violation of peoples rights" ([#1242](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1242)) |
| Fixed in core, not on hosted | F2 the fleet's creator cannot join a computer ([#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303), release order [#1258](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1258)) |
| Open, issue | F1 no gateway in a new fleet ([#1233](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1233)). F6 raw JSON in meeting notices ([#1237](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1237)). F10 notices needing no action ([#1241](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1241)). F12 nine setup questions ([#1243](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1243)). F14 17 switches, none to add later ([#1245](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1245)). F16 invite mail names no inviter ([#1247](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1247)). F17 "Can't reach the sign-in service" after sign-up ([#1248](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1248)) |
| Open, no issue | F20 to F28: Help goes to GitHub, unexplained words, "Only argo so far", Settings text, silent disabled Create fleet, GMT times, clipped column, Release text, internal ships in the MCP list |
| Not a block | F5 ChatGPT's connection |

Not walked: production's plugin defaults for new fleets, Codex, Copilot, Cursor, a real company directory, a real laptop after setup.

### 2.2 The design system

| # | Lesson | Source |
| --- | --- | --- |
| D1 | Parts take props only; each app's server reads the data and hands the part what to show. A part one app alone shows stays in that app | ui-package UP0, UP2; 0033 |
| D2 | The scope picker is the gateway's: a multi-select with each picked scope as a chip with its code, searched by code or description, showing both; each scope's description comes from the app's server. It replaces the commission dialog's switches and pagasae's right rows | ui-package mockups, UP3; [#1205](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1205) |
| D3 | Compact: controls 32 px, rows 40, body 13, cards with a border and no shadow; StatusBadge as icon and word in its tone, only Attention filled; phone touch sizes stay 44 px; long prose stays 14 px. Icon and word on every status, contrast 4.5:1, one primary per view | ui-package mockups, "The look" |
| D4 | Harbour: numbers on top (ships, Alert, Waiting, Working, Idle), then a tile per ship grouped People, Agents, Plugins, Through the gateway; colour marks only what is going on. A new fleet already has tiles (argo, people, plugins) and no agent | fleet-overview |
| D5 | One header for every app, with the app switcher and the avatar menu; each app stays its own Next.js app with its own routes | header H2, H3; 0043 |
| D6 | The parts are not built yet: Compact, the shared scope picker and StatusBadge land slice by slice (U3 to U20). A screen drawn in Compact ships only once its parts have | ui-package section 7 |
| D7 | Test ids fixed and named for the part; text selectors are the end-to-end tests' largest anti-pattern | UP5; [#1412](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1412) |

### 2.3 Decisions and designs

L1 to L14 are cited by [journeys.md](journeys.md).

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Sign-up creates the organisation, its first account (organisation admin, allowed as argo) and its first fleet. The fleet manager holds every scope the fleet offers. The organisation admin's right never implies fleet scopes | 0051 |
| L2 | pagasae signs every account in by mailed link; Home, groups and rights live in the account app, the fleet's management in the console. One sign-in for every app | 0054, 0052 |
| L3 | Adding a computer takes `trierarch:join`, checked on whoever adds it; a trierarch on a person's computer is owned by their person ship | 0055, 0045 |
| L4 | Argo is the fail-safe, never a normal path. Every argo job is a scope any actor can hold | 0012, 0053, 0057 |
| L5 | A secret (starting prompt, crew line, setup line) is shown once; a new one stops the old one. A lease is held until released, a second claim fails | 0010 |
| L6 | The installation sets one guide per audience and notices; progress is kept per account | 0024, 0023 |
| L7 | A person reaches the fleet through the gateway's one address; it finds the fleet from the account and crews the person ship, with basic pages of its own | 0054 |
| L8 | Waking a person: consent first, nothing on by default, no content in the wake. With Slack linked, the person chooses Slack, the gateway page or both while a page is in focus | wake-a-person; gateway-scopes P-B5 |
| L9 | One meaning per term, defined in the blueprint; a trierarch runs on a computer, never a machine | 0050 |
| L10 | Errors say what failed, whether anything changed, and what to do. An empty state says what is empty and what happens next. A disabled control shows its reason | `conventions.md` |
| L11 | A mic request answers with the queue and the place in it | [#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240) |
| L12 | Before 1.0.0 breaking changes are allowed; keep designs minimal | 0013 |
| L13 | A fix that crosses packages is a cross-package contract (the setup line is the trierarch plugin's, the starting prompt core's) | 0049 |
| L14 | A fix that passes in core can still fail on hosted while another train lags | [#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303) |
| L15 | Sessions run headless since 0.33.0; a crew line exists for Claude Code, Codex, Copilot and Cursor; container sessions run Claude Code only | headless; harnesses S6, S11; 0039 |
| L16 | Feature flags and plugin defaults for new fleets are set in pagasae | 0069; F1 |

### 2.4 Decided on 27 and 28 Oct, before the restart

Thomas answered these on the first round (the questions and their options are in the git history of this file). Thomas then: "I made some assumptions answering the questions, but I don't want to start doing like major changes based on those assumptions. So every time that we are going to do adjustments on screens and everything like that, I do want to have a gate that goes through me." Whether they carry over is R2.

| # | Decision |
| --- | --- |
| Q1 | Scenarios per friction in the console, gateway and account app, and one final walk of both people on staging as the release gate |
| Q2 | Each page's empty state names the next step from the fleet's own state; the guide stays a short orientation |
| Q3 | The installation's default for new fleets includes the gateway; where it is off, Home tells the colleague why |
| Q4 | Design for the technical person first; the hand-off is named where joining a computer is refused |
| Q5 | The setup line asks nothing and applies safe defaults; changes come later, by the command on the computer (N3) |
| Q6 | A computer whose setup has not finished gets a new setup line from its card |
| Q7 | Each right as the sentence "Your rights" uses, grouped by what the ship does, the scope name in mono beside it; a reason beside the disabled button; a Grant on the ship page |
| Q8 | The first time a colleague opens the gateway after an invite it asks once: "Mail me when something waits?" |
| Q9 | The invite mail names the inviter and the organisation and says what Aeolus is; the welcome page names the organisation; an expired link's page offers a new link to the same address |
| Q10 | Bea's pages show fewer terms; Ada's console explains each term once where it first appears. No term is renamed |
| N1 to N5, J1 to J4 | In [journeys.md](journeys.md) section 8 |

## 3. Questions (stage 1)

### R1. The purpose

Context: section 1 keeps the 27 Oct purpose and adds two things the design system brings: one product across the three apps (outcome 5) and Harbour as the first fleet view.

Options:
1. **Section 1 as written.**
2. **The 27 Oct purpose unchanged;** the design system is only the look the mockups are drawn in.

Pick: 1. The newcomer is the person who crosses all three apps in one sitting; a seam between them is a friction the audit could not see because each app was walked on its own look.

### R2. What carries over from the first round

Context: section 2.4 and journeys.md section 8. Two answers now meet a settled part: Q7 (rights as grouped sentences) meets the shared scope picker (D2), and Q8 (ask once about mail) meets the person's choice of Slack, the gateway page or both (L8).

Options:
1. **All carry over, but Q7 and Q8, which are asked again in stage 2** against the shared parts.
2. **All asked again in stage 2.**
3. **All carry over unchanged.**

Pick: 1. The journeys and the other answers name no screen, so the design system does not touch them; Q7 and Q8 each name a part that is now decided elsewhere.

### R3. What "before" shows in a mockup

Context: Compact is chosen and not built (D6). A before drawn from today's screens mixes the look change, approved under #1206, with this design's change.

Options:
1. **Before is the screen in Compact as it would look with no onboarding change; after adds the change.** Only this design's change differs.
2. **Before is today's screen on staging; after is Compact with the change.**

Pick: 1. Thomas approves what onboarding changes, not the look again.

### R4. Order against the ui package

Context: many onboarding fixes change no screen (F2 on hosted, F12 setup questions, F16 the mail's inviter, F27 and F28 words, the setup line's checks); the rest need ui parts that land slice by slice (D6).

Options:
1. **Changes with no screen go first; each screen change ships once the ui parts it uses have landed,** and is drawn now.
2. **Everything waits for the ui package.**
3. **Screens built now on today's parts,** restyled when ui lands.

Pick: 1. Fixes that need no part reach newcomers now; option 3 builds each screen twice.

### R5. Where the next step lives

Context: Q2 put the next step in each page's empty state. Harbour is no longer empty in a new fleet (D4): it shows argo, the founder's person ship and the plugin ships, with no agent.

Options:
1. **Harbour carries it:** while the fleet lacks a step (plugin connected, computer joined, ship commissioned), Harbour says the first missing one and who can do it; it goes once an agent ship is crewed.
2. **A getting-started page of its own,** linked from Harbour until done.
3. **The guide (0024) only.**

Pick: 1. Harbour is where Ada lands; a second page is one more place to find. The exact form is a stage 2 mockup.

### R6. Ada's harness

Context: the audit walked Claude Code. Starting prompts now offer Codex, Copilot and Cursor crew lines too (L15); the setup line checks Claude Code; container sessions run Claude Code only.

Options:
1. **Claude Code is the path designed and walked;** the other harnesses stay as the starting prompt offers them, not walked.
2. **Every harness the starting prompt offers is designed and walked.**

Pick: 1. One path made flawless first; the others have their own designs.

### R7. Update this pull request or replace it

Context: [#1317](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1317) held the first round and its parked mockups in today's look.

Options:
1. **Update #1317:** this file replaces the first round; the parked mockups go (git keeps them); journeys.md stays.
2. **A new pull request,** #1317 closed.

Pick: 1, done in this pull request; Thomas's earlier answers stay readable on it.
