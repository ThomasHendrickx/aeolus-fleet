# Today's hosted paths, walked

The walk for [README.md](README.md) section 3: each persona path that exists today, walked on staging as brand-new people, on 17 Nov 2026, with staging at gateway 0.40.2, core 0.40.0 and the trierarch plugin 0.41.0. Two people: a Builder (`p1walk.builder.1117@example.com`, who signed up) and a Decider (`p1walk.decider.1117@example.com`, added by the Builder). Each step names what the person and their agent did, what they had to know or guess, and where they got stuck: the S numbers are README section 3's.

How it was walked: the person's steps in a browser, as a person clicks them; the agent's steps through the ship contract's REST door, the calls the plugin makes. Not walked: installing the plugin in a fresh harness (the walking computer is shared and has it), joining a computer (it would install a trierarch there), and a chat connector (it needs a person's own claude.ai or ChatGPT). The demo was read on production: staging has none.

## The agent, pointed at Aeolus

| Step | What happened | Stuck |
| --- | --- | --- |
| Told "help me try Aeolus", the agent opens llms.txt | One summary line, then 8 pages and about 35 docs in lists; Quick start is second, described as "from sign-up to a first connected agent". Nothing asks which kind of person is trying | S1 |
| Agent tries `aeolus-fleet.dev/start` | 404, "This page sailed away" | S1 |
| Agent reads Quick start | Five steps for one person with Claude Code or Codex; every address is production's. Nothing for a Decider or a Flow owner | S2 |

## G. Get a fleet (Builder)

| Step | What happened | Stuck |
| --- | --- | --- |
| Person enters their email at the account app | "Check your mail", link works once and expires in 15 minutes. The agent cannot open it | S3 (by design) |
| Person opens the link | Terms page, then "Name your organisation and fleet". Sign-up cap not reached on staging | none |
| Create fleet | "Your fleet is ready", Open console | none |
| Account home | The new fleet already shows **Needs a look: "Trierarch plugin is on but not connected. Gateway is on but not connected."** "See why" repeats it under Plugins connected and says nothing about what to do | **S15 new** |
| Open console | Opened at once, no sign-in service error (S4 not met on this walk, #1248 stays open). Fleet overview shows argo (idle) and the person ship (**awaiting crew**). No plugin ships: none is connected | S16 new, minor |

## B1. An agent asks them a question

| Step | What happened | Stuck |
| --- | --- | --- |
| Commission ship | One dialog: name, type, note, a "Fleet access" picker (empty: send and receive only), "Request a crew" switch. No owner to pick, no 17 switches (#1245 fixed) | S6 closed |
| Type field | Its suggestion list stays open over the Commission button; Enter submits | minor |
| Starting prompt | Shown once: crew instructions for a chat, crew lines for Claude Code, Codex and Copilot, with "shown once, copy it now" | S7 (by design) |
| Lose it | The ship page's "Get starting prompt" gives a new one at once, the old one ends; no confirm | none |
| Ship page | Owner is the person ship, but the timeline says **"Owner set: argo by default"** | S17 new, minor |
| Agent crews (`register`) | Crew token, `whoami` answers with owner the person ship. `whoami` is GET: an agent that guesses POST gets 404 "Nothing is served at this path" | minor |
| Person opens Bridge | **"The record cannot be read now. The fleet did not answer... Bridge tries again in 10 s"**, forever. "Your fleet" says "The gateway is not connected to your fleet". Neither says what to do | **S8, blocks** ([gateway#405](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/405)) |
| Way out, found by looking | Console, Settings ("Only argo, the operator, sees this page"), **Connect gateway**: connected at once, Bridge works. Nothing on Bridge, the account app or Quick start points there | S8 |
| Agent asks the person ship | Question in Bridge within seconds: options, the agent's pick, one-click answer | none |
| Person answers | Agent receives the answer (`inReplyTo` the question) | **first value reached** |

## B2. Two agents hand work to each other

| Step | What happened | Stuck |
| --- | --- | --- |
| Commission `reviewer` | Same dialog | none |
| writer sends reviewer a task before reviewer is crewed | Stored, waits | none |
| Send to a misspelt name | 404 "No active ship is named reviewr"; does not mention `discover` | minor |
| reviewer crews, receives, acks, replies with `inReplyTo` | Reply in writer's receive | none |
| A message sent while reviewer is down; a reply received and not acknowledged | Both handed over at the next receive, the unacknowledged one with attempts 2 | **first value reached** |

## B3. Their own app sends work

| Step | What happened | Stuck |
| --- | --- | --- |
| Home's REST snippet, as written | 400 "send needs model"; no JSON content type; no word on where `$CREW_TOKEN` comes from | **S11, blocks** (filed on the site's repository, 17 Nov) |
| Ship contract page, then the fleet's `/api/v1/docs` | register, send, receive, ack work as the page says | none |

## D1. A Decider, added by a builder

| Step | What happened | Stuck |
| --- | --- | --- |
| Builder adds the email (People and groups) | "is added. We mailed them a sign-in link. They have no rights in a fleet until a group or their own give them." | none |
| Decider opens the link | "Welcome to P1 Walk Builder. **An admin of P1 Walk Builder added you**... Aeolus connects P1 Walk Builder's people, AI agents and applications as one." What Aeolus is: said. Who added them: not named | S9 (half) |
| Decider's account home | "**You have no rights here yet**", with an "Open gateway" button; Bridge sends them back to the account home. Nothing says what to ask the builder for | **S18 new** |
| Builder gives rights | A builder must know to make a group, switch the Decider into it, tick "Talk with the fleet from Claude or ChatGPT" and press **Save rights** (ticking alone saves nothing). Nothing on the add step or the account says so | **S18** |
| Decider's Bridge | Opens; "Nothing waits on you. Your ships have what they need from you": the Decider has no ships | minor |
| Builder's agent finds the Decider | `discover` lists `p1walk-decider-1117` as a person ship. The agent has to guess that name from the email | minor |
| Agent asks the Decider | The question shows in the Decider's Waiting on you, with no basket button | none |
| Decider opens it | **The page stays blank**: no question, no error, after 15 s and a reload. The Builder opens their own the same way | **S19 new, blocks** ([gateway#404](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/404)) |

First value not reached.

## D2. A Decider, alone

The live demo (production, read-only, no account): a console tour, 9 steps, of a fleet with scripted ships; its operator inbox has 3 open, which the viewer cannot answer. Nothing puts a question to the visitor or says what to send a builder. S10 confirmed.

## F1. A Flow owner

aeolus-fleet.com: an illustrated order-to-invoice flow, "Discuss a flow that gets stuck" (a conversation with Aeolus) and the demo. No self-serve path; nothing names where hand-offs show in the console. S12 confirmed.

## B4. Build your fleet with a steering ship

No path. What exists for one, walked as far as it goes without installing on the walking computer:

| Step | What happened | Stuck |
| --- | --- | --- |
| Console, Trierarchs | "The trierarch plugin is not connected. Connect it in Settings": the new fleet comes without it (S15). Connecting it is one more step before a computer can join | **S15** |
| Commission dialog, Fleet access | The person may pick any of 18 scopes beyond send and receive, one by one, from a searchable list; a starter ship's set can be given at commission | none |
| Same dialog | Says of these rights "**It cannot be changed later**"; the [scopes guide](../../guide/scopes.md) says `scopes:grant` changes them on a live ship. The ship page shows its scopes with no control to change them. Fixed on main by #1899 (live permission editing), not yet released to staging: checked again on the core 0.41.0 walk | S20 new, fixed on main |

S13 confirmed: no starter ship, no list of the rights it needs.

## Every path

No path ends by naming the next one, except Quick start's "Next" cards (Hand-offs, Sessions, Run it yourself). S14 confirmed.
