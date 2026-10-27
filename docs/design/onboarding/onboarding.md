# Onboarding: getting into the fleet

Design for [#1228](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1228), Aeolus 0.33.0. Docs only. Stage 1: purpose, lessons, questions. Nothing here is decided until Thomas answers.

## 1. Purpose (for Thomas to agree)

A new person in a company gets from "I was told to try Aeolus" to doing their part in the fleet without help, a guess, or someone who knows the insides. This is the hosted path: sign-up and sign-in by mailed link at the account app, the first fleet, the console, joining a computer, commissioning and crewing ships, and inviting colleagues who use the gateway.

Thomas (25 Oct): "Since our main advantage now against the competition we identified is our focus on connecting technical to non technical people on a company, user friendlynes to get into the fleet should be flawless". Getting in has to work for both people the product connects.

For whom:
- **The technical person** (Ada in the audit) who signs up, sets the fleet up, joins a computer and crews the first ship.
- **The non-technical colleague** (Bea) who is invited, answers ships, joins meetings and may use Claude or ChatGPT through the gateway. Bea never sees a terminal.
- **The organisation admin**, who is the first person to sign up and holds the organisation (0051).

The outcomes:
1. Ada goes from the sign-up mail to her first ship answering her message in one sitting, and at each screen sees what comes next. She never needs to know that argo, a scope or a harness exists to get there.
2. Ada invites Bea and the fleet is ready for Bea: what she was given works, with nothing Ada must ask the hosting service for.
3. Bea goes from the invite mail to her first answered question without meeting an id, JSON or a word nobody explained, and is told when something waits while she is away.
4. A step that fails or is interrupted says what happened, whether anything changed, and the next step. Nobody is stranded, and nobody needs argo's fail-safe (0012) to get past a normal step.
5. A new technical person and a new non-technical person, each walked on staging with no help, reach their first ship answering (Ada) and their first answered question (Bea).

Not the purpose (each is its own issue already, or outside the hosted path):
- A marketing site and what it says (staging has none).
- Listing Aeolus in the chat apps' directories ([#1214](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1214)), ships as Slack bots ([#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227)), waking a person through chat bots ([#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078)), the channels research ([#1229](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1229)).
- Connecting Entra or Google for a company ([company-sign-in design](../accounts/company-sign-in.md)).
- Self-hosted installs (one person, as argo).

## 2. Lessons to check against

### 2.1 What the audit found, and what still holds

Source: the onboarding audit, [PR #1232](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1232), `docs/audits/onboarding-2026-10-25/README.md`, walked on staging at 0.31.0 as Ada and Bea. Its frictions are numbered there (F1 to F28). Status is read from the issues and merged work at 0.32.0 and on main, not walked again.

| Status | Frictions |
| --- | --- |
| Fixed | F3 plugin install not explained, wrong guide command ([#1235](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1235), #1251). F4 an interrupted setup locks the ship ([#1236](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1236)). F7 gateway Overview scrolls sideways ([#1238](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1238)). F18 stuck delivery in red after joining a machine ([#1249](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1249)). F19 disabled Connect buttons without a reason ([#1250](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1250)) |
| Fixed in core, not proven on hosted | F2 the fleet's creator cannot join a machine ([#1234](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1234), #1253). On staging at 0.32.0 pagasae still ran common 0.30.0 and the join was refused again: [#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303), release order in [#1258](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1258) |
| New since the audit | A trierarch upgraded to 0.32.0 does not start because the Claude Code plugin was renamed ([#1312](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1312)) |
| Holds, issue open | F1 no gateway in a new fleet, nobody in the organisation can switch it on ([#1233](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1233)). F6 raw JSON in meeting notices ([#1237](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1237)). F8 a lost setup line cannot be got again ([#1239](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1239)). F9 mic arrival not shown ([#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240)). F10 list fills with notices needing no action ([#1241](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1241)). F11 email alerts off ([#1242](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1242)). F12 nine unexplained setup questions ([#1243](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1243)). F13 setup checks neither Claude Code nor Node ([#1244](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1244)). F14 17 switches and no way to add one later ([#1245](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1245)). F15 empty starting prompt after Commission ([#1246](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1246)). F16 invite mail names no inviter ([#1247](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1247)). F17 "Can't reach the sign-in service" after sign-up ([#1248](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1248)) |
| Holds, no issue | F20 to F28, the rough ones: Help goes to GitHub, unexplained words, "Only argo so far", Settings text, silent disabled Create fleet, GMT times, clipped column, Release text, internal ships in the MCP list |
| Not a block | F5 ChatGPT's connection (checked in the audit; one part unproven) |

Not walked in the audit: the site, production's plugin defaults for new fleets, Codex, a real company directory, claude.ai and ChatGPT themselves, a real laptop after setup, Claude Code interactively. These stay unknown here too.

### 2.2 Decisions and designs

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Sign-up creates the organisation, its first account (organisation admin, allowed as argo) and its first fleet. The fleet manager holds every scope the fleet offers. The organisation admin's right never implies fleet scopes | 0051; accounts design, Q13 |
| L2 | pagasae signs every account in by mailed link; Home, groups and rights live in the account app, the fleet's management in the console. One sign-in for every app | 0054, 0052 |
| L3 | Adding a computer takes `trierarch:join`, checked on whoever adds it; a trierarch on a person's computer is owned by their person ship | 0055, 0030 |
| L4 | Argo is the fail-safe, never a normal path. Every argo job is a scope any actor can hold | 0012, 0053 |
| L5 | A secret (starting prompt, crew line, setup line) is shown once; a new one stops the old one. A lease is held until released, a second claim fails | 0010, `StartingPromptBlock`, `CrewLineBlock` |
| L6 | The installation sets one guide per audience (1 to 10 steps) and notices; progress is kept per account. Take the tour opens it again | 0024, 0023 |
| L7 | A person reaches the fleet through the gateway's one address; it finds the fleet from the account and crews the person ship. The gateway has basic pages of its own for a person with no chat at hand | 0054; accounts design, Q8 to Q10 |
| L8 | Waking a person: consent first, nothing on by default, email sent by pagasae, no content in the wake | wake-a-person design, W2, W4, W8 |
| L9 | Domain language: one meaning per term, defined in the blueprint; invent no synonyms | 0050; CLAUDE.md |
| L10 | Errors say what failed, whether anything changed, and what to do. An EmptyState says what is empty and what happens next, with one action only when the person can fix it from here. A disabled control shows its reason | `conventions.md`, InlineError, EmptyState |
| L11 | A mic request answers with the queue: "it returns a success message with the current queue so you see who has the mic when and your place on the queue" (Thomas, 27 Oct) | [#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240) comment |
| L12 | Before 1.0.0 breaking changes are allowed; keep designs minimal | 0013 |
| L13 | A fix that crosses packages is a cross-package contract: the setup line is built by the trierarch plugin during `machines.join`, the starting prompt by core | [#1239](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1239) comment; 0049 |
| L14 | A fix that passes in core can still fail on hosted when another train lags a version | [#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303), [#1258](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1258) |

## 3. Questions for Thomas

**Q1. What does "flawless" mean as a test?**
Today the audit is the measure: two walkers on staging, frictions ranked. The design needs a bar the build is held to.
1. A walk on staging by Ada and Bea with no help: no Block, no Hurt left, Rough ones listed. Judged by Thomas from the walk.
2. Scenarios only (each friction becomes one scenario, tested in the console, gateway and account app), no new walk.
3. Both: scenarios per friction, and one final walk of both people as the release gate.

Pick 3. Scenarios hold the build to the fixes; a walk is the only thing that catches the gap between parts (F2 passed in core and failed on hosted, L14).

**Q2. How does a new fleet's creator learn what comes next?**
The audit found no page that says "next: connect a computer". The console has a guide (0024), a tour the installation sets by audience with progress per account, and EmptyStates that point to one action.
1. The existing guide only: one tour for a new fleet's creator, set by the installation.
2. Each page's empty state names the next step from the fleet's own state (no plugin connected, no computer, no ship, no colleague), and the guide stays a short orientation.
3. A new part: a checklist that stays on the overview until done.

Pick 2. The state already says what is missing, a tour goes stale and is skipped, and a checklist is a new part with its own vocabulary.

**Q3. Does a new fleet have the gateway?**
Without it Bea has no page and no chat connection (F1). Today only the installation's admin turns a plugin on per fleet; a new fleet gets the installation's defaults (trierarch and networking on staging; production's were not checked).
1. The installation's default for new fleets includes the gateway, so a sign-up fleet has it. No product change; cost: every fleet carries it.
2. The fleet manager switches the gateway on in Settings for their own fleet. A new scope-checked action; the hosting service loses the per-fleet say.
3. Only the installation's admin, as today, but Home tells the colleague why it is not available and who can fix it.

Pick 1, with 3's wording for any fleet where it is off. Thomas's line is connecting technical to non-technical people, and the gateway is that connection. Option 2 reopens who controls plugins per fleet; raise it as its own question if wanted.

**Q4. Who signs up first?**
The path assumes a technical person signs up, holds the organisation and the fleet, and invites the rest (L1). A non-technical founder may sign up instead and need a colleague to join the computer.
1. Design for the technical person first. If a non-technical person signs up, they invite the technical one and give them the right to add a computer through a group (rights exist today); the design only makes that hand-off visible.
2. Design both entries equally: a new fleet's page asks "do you set up the computer yourself?" and sends an invitation if not.
3. Technical first only; no hand-off in the design.

Pick 1. The rights already allow the hand-off, so the design names it at the one place it is needed (Join a machine refused for lack of the right) without a second entry.

**Q5. Where do the machine setup's choices live?**
The setup line runs nine questions in the terminal (F12) and checks nothing first (F13). Worktrees, folders, caps and permission modes are the trierarch's configuration (0026, 0027).
1. Keep them in the terminal, but check Claude Code and Node first, ask only what has no safe default, and say in a sentence why each is asked.
2. Move them to Join a machine in the console. The setup line carries the answers and the terminal asks nothing. Needs a contract between the trierarch plugin and the trierarch (L13).
3. The setup line asks nothing and applies safe defaults; changes are made later from the console or a command.

Pick 3. The first run needs no decision from a person who does not yet know what a worktree is; defaults can be changed once they have a ship working. Option 2's contract also serves Q6, so it can follow.

**Q6. How is a lost setup line got again?**
The setup line carries a secret and is shown once (L5). The ship page's new prompt has no setup line (F8, #1239); the plugin builds it only at `machines.join` (L13).
1. The Trierarchs page gets a new setup line for a machine whose setup has not finished (a new secret, the old one stopped), built by the trierarch plugin that builds it today.
2. Core's starting prompt for a computer's ship includes the setup line. Needs core to know the plugin connection; a cross-package change.
3. A lost setup line means joining the machine again under a new name; the page says so.

Pick 1. It keeps the setup line where it is built, and the recovery is one click in the place the person already is.

**Q7. How are a ship's permissions chosen at commissioning?**
17 switches by scope name, disabled button until a hidden choice, and no way to add one later from the console (F14). "Your rights" already has a plain sentence for every right, and the console can grant scopes to a ship (0053).
1. Keep the scope list; add a reason beside the disabled button and a Grant on the ship page.
2. Show each switch as the plain sentence "Your rights" uses, grouped by what the ship does, scope name in mono beside it; plus a reason beside the disabled button and a Grant on the ship page.
3. Fewer switches: ask only for what a ship's type needs, everything else after commissioning.

Pick 2. It reuses the sentences that exist, adds no vocabulary, and the Grant ends "can never be granted" without removing choice.

**Q8. How does Bea hear that something waits?**
Email alerts are off by default (F11), and the wake design decided nothing is on by default (L8, W8). A colleague who is not in the gateway all day never learns a ship asked her something.
1. Keep W8. The first time Bea opens the gateway after an invite it asks once: "Mail me when something waits?" with one button.
2. The invite mail says so, and email is on for an invited colleague until she turns it off. Reopens W8.
3. Keep as is: she finds the switch herself.

Pick 1. It keeps consent first and meets her at the moment she first sees a waiting item. If you want 2, it changes a recorded decision.

**Q9. What does the invite mail promise, and for how long?**
It names no inviter and no purpose, its link lasts 15 minutes, and the welcome page does not name the organisation (F16).
1. The mail names the inviter and the organisation and says in one sentence what Aeolus is and what Bea will be asked to do; the welcome page names the organisation. An expired link's page offers a new link to the same address.
2. As 1, and invite links last longer (for example 7 days).
3. Only the wording of 1; links unchanged and expiry stays a dead end.

Pick 1. A new link on expiry fixes the stranded case without lengthening a mailed credential; 0054 sets mailed links as the sign-in, so a longer life is a security choice for you.

**Q10. How are the words a newcomer does not know handled?**
Fleet, ship, commission, crew, trierarch, scope, mic and others are used before they are explained (F21). The blueprint defines them (L9).
1. Keep every term; explain each once, in one short sentence, where it first appears on that person's path, in plain text on the page (never only in a tooltip).
2. For Bea's pages (Home, the gateway) show fewer of them: no fleet-management words, because she manages nothing. Ada's console keeps them all with 1.
3. Add a glossary page and link to it.

Pick 2 with 1. Bea needs only ship, question, meeting and mic, and a glossary is read by nobody mid-step. No term is renamed either way.
