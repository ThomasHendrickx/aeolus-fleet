# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-10-17.

This plan takes aeolus-fleet from an empty repo to the v1 acceptance test (two ships exchange messages back and forth) in Claude Code sessions, one PR each. A slice with a written prompt below uses it; any other uses the template.

| Who | Owns |
| --- | --- |
| Thomas (operator) | Scope, behaviour, every merge, every question the docs do not answer |
| Claude Code (per session) | Discovery in the repo, implementation, tests, the PR and its description |
| A clean-room reviewer (fresh session) | The only review: the PR against the slice's done criteria, before merge |

[blueprint.md](blueprint.md) and [architecture.md](architecture.md) are the source of truth, and [decisions/](decisions/) records why. When a session finds a gap, it stops and asks; it never fills the gap with its own guess. The design canvas is look and feel only ([design/README.md](design/README.md)).

## Still to do outside the code (Thomas)

- [ ] Branch protection on main: PR required, CI must pass
- [x] Claim the npm org `aeolus-fleet`
- [x] Publish `0.0.0` placeholders for `@aeolus-fleet/core`, `@aeolus-fleet/console`, `@aeolus-fleet/common`
- [x] Configure trusted publishing (OIDC) for every published package: GitHub Actions, repo `ThomasHendrickx/aeolus-fleet`, workflow `release.yml`
- [x] Publishing access on every published package: require two-factor authentication and disallow tokens

## The build plan

One session per row, one PR per session, merged before the next starts. Slices 0 to 8 (with 1b, 1c, 6b and 8b) are done; git history holds what each built. Now: hardening, release `0.1.0`, then the deploy in the private `aeolus-fleet-infra` repo (in parallel) at `fleet.aeolus-fleet.dev`; the console and the rest come after that.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 9 | Hardening | Production readiness of the packages as installed from npm | See the slice 9 prompt below |

After hardening: Thomas runs the Release workflow for `0.1.0`; the infra repo deploys that version. Thomas's decision session is an agent ship (messages only); he commissions and releases ships in the bare console.

Then, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm (retire locks the ship `FOR NO KEY UPDATE` before abandoning direct deliveries, so a racing send's `FOR SHARE` serialises with it), Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`).

## Epic: the trierarch plugin

What the trierarch plugin and a trierarch do is in [trierarch.md](trierarch.md), their build in the architecture ("The trierarch"), and why in decisions 0026, 0027, 0029 and 0030. The 0.17 trierarch (slices D1 to D6) and this epic (slices T1 to T5, released in 0.19.0 and running on Thomas's Mac) are done; git holds what each built. Labels (#102) are in the core (decision 0031); they steer placement once the trierarch plugin labels machines from their reports and honours a selector in a request's settings; until then placement reads the reports. The console's screens (core crew request screens, the trierarch plugin's section beside Squadrons, the machines page) are their own design pass.

## Epic: the scope rework (0.27.0)

Fine-grained scopes, owners, network verbs and read reach (#348, #600, #866), from the decided design on branch `design/scope-rework`. R1 turns that design into decision records and doc updates. Every later slice builds from the docs; the branch stays as history only. Each slice is one PR, works on its own, and waits on nothing after it. The template above applies: strict TDD, each guarantee proven by a named test, each state change writing its event, no compatibility layer.

Not in this epic: the MCP and A2A interop gateway, the packaging split (plugin pages out of the console), the trierarch plugin's placement ruleset, and the networking plugin switched on at fleet create (the hosting service).

| # | Slice | Where | After | Builds | Done when |
| --- | --- | --- | --- | --- | --- |
| R1 | Docs | docs | none | Decision records for owners and kinds; network verbs, built-in rules and explain naming the rule (amends 0034, 0035); read reach; the scope catalogue (amends 0002); contained access (amends 0039); discovery and statements; forced delivery (amends 0040); questions and trouble to the owner (amends 0038, 0026); core's surface. The blueprint's language, scopes and flows, the architecture's tables and events, and the README index lines | Every decision of the design (part 5: 1 to 13; part 0: 0.A to 0.V) is the current rule of exactly one record. No doc on main points to the design branch, the blueprint's Principles included. Each record is short: rule, why, rejected |
| R2 | Kinds person and app | core | R1 | Ship kinds `person` and `app` beside `agent`. Only an agent states a model. Only argo commissions a person or app ship. A person ship awaiting crew is not stuck | Commission and send refuse or accept by kind as the record says, each with a test. Stuck-delivery counts leave out person ships (test). Migration adds the kinds |
| R3 | Owners | core | R2 | An owner on every ship but argo and the viewer: inherited at commission, argo by default (`OwnerSet`). `fleet.setOwner` is argo's only (`OwnerChanged`). Retiring an owner moves its ships to argo (`OwnerChanged` on each). `whoami` and the ship read show the owner | Each path writes its event in the same transaction (tests, including rollback). A non-argo setOwner is refused. Migration sets argo as the owner of every existing ship |
| R4 | Force in core | core | R1 | `messages:force` and `send` with force: forced deliveries come first in receive and push receive (decisions 3, 4); the force rides send reach | Ordering is proven under concurrency. A send without the scope is refused. The delivery records it was forced (event) |
| R5 | Contained access | trierarch, aeolus plugin | R1 | One socket per ship in a mounted folder. The crew token lives in the trierarch's state, never in the ship's home. `aeolus-fleet.sh` calls over the socket with no bearer. The trierarch adds the bearer, checks the path and size, refuses `register` and `deregister`, and logs one line without the body. A hand-crewed session keeps its token | A container session sends, acks and reports with no token in its home (test). Answers pass through unchanged, a 503 included. While the trierarch is down a call gets no answer and nothing is stored (test). A new crew token reaches the same socket (test) |
| R6 | Network verbs and built-in rules | core | R3 | Each rule names send, read or manage. An owner selector term with `#`. Built-in rules seeded at fleet create: argo, the owner and the answer can never be turned off; the viewer and open rules are turned off by their own action, with an event. `explainReach` answers per verb and names the rule; a refusal names the settings version. The migration makes existing rules send rules | Send behaviour is unchanged for an existing fleet (the existing reach tests stay green). Each built-in is proven, and so is the refusal to turn off a fixed one. Explain names the rule (test) |
| R7 | Networking plugin verbs | networking plugin | R6 | The rule editor and its stored rules carry a verb and the owner term; built-in rules are shown apart, first | The plugin sets send, read and manage rules through core (Testcontainers). The built-ins show, and a fixed one cannot be removed |
| R8 | Scope declare and grant | core | R3 | `scopes:declare` and `fleet.declareScopes`, one namespace per ship for good; `fleet.scopes`; `scopes:grant` and `fleet.grantScopes` on a live ship, effective at the next call (decision 1); the subset rule at commission and grant (decision 2); `ScopesDeclared` and `ScopesChanged` | Each refusal in the catalogue's list has a test. A grant takes effect on the next call (test). Retiring the declarer frees its namespace |
| R9 | Read reach | core | R6 | Every `fleet:read` procedure is filtered by read rules: a message by its sender or recipient; outside read reach, name, type and status only; the fleet-wide views reduced; `follow` and `events` filtered | For each read procedure, a test shows a ship outside read reach sees only what the record allows. argo and the viewer read all through built-ins |
| R10 | Discovery and statements | core, aeolus plugin | R6 | The discovery call (send reach: name, type, status, statement). A ship's statement (summary plus capabilities, shape in common, at most 64 KB, kept with the lease, versioned, with an event); the commission note as the default. The plugin's calls and the protocol text | Discovery answers exactly the send reach (tests with rules). A statement is visible only to ships that can send to it. Size, shape and the release clear are tested |
| R11 | Scope catalogue and the one migration | core, console, squadrons, trierarch plugin | R8, R9 | `fleet:manage` split into `fleet:commission`, `messages:resend` and `fleet:manage` bounded by manage reach; `labels:assign` bounded (decision 5); one migration of every holder; Connect's scope sets; squadrons and the trierarch plugin on their new sets | Old scope names no longer exist. Each holder keeps what it did within the new bounds (migration test). Each bound has a refusal test |
| R12 | Forced hand-over | trierarch, aeolus plugin | R4, R5 | The trierarch stops a busy turn and hands the forced message over as a new prompt. A hand-crewed session gets it at its next tool call or Stop. A stopped turn's message is handled when the forced turn ends (decision 11) | Each path is proven in the trierarch and plugin tests, including a forced message arriving mid-turn |
| R13 | Questions and trouble to the owner | core, trierarch | R3 | The ship protocol sends questions to the ship's owner, argo as fallback. The trierarch's crash report and give-back notices go to the owner. argo keeps Needs attention | Protocol text test. The trierarch's crash report reaches the owner (test), and argo when argo owns the ship |
| R14 | Plugin read on behalf | core, squadrons | R9, R8 | A plugin ship argo connected reads for a named ship and gets that ship's read reach. Squadrons serves a person only what that person may read | A read on behalf never returns more than the named ship's own read (tests). A non-plugin caller is refused |
| R15 | Squadrons forming by ships | squadrons, core | R3, R8, R6 | Squadrons declares its namespace (`squadrons:form`, `squadrons:scale`). A ship forms a squadron by message (decision 7). Squadrons names the forming ship's owner on the squadron's ships (`OwnerSet`, 0.T), so they reach the forming ship by the same-owner rule. The flagship proxies to the forming ship (decision 10). Templates grant within the subset rule (decision 8) | A ship with `squadrons:form` forms and stands down a squadron end to end (test). Only a plugin may name another owner (core test). Same-owner reach holds with rules in force |
| R16 | Squadrons scale and a retired forming ship | squadrons | R15 | `squadrons:scale` adds and removes members. When the forming ship is retired, the flagship proxies to its owner, argo as fallback (0.R). Limits come from squadrons' configuration (decision 9) | Scale and the fallback each have a test. A ship without the scope is refused |

**In parallel** (no shared files):
- R5 runs beside any core slice.
- R4 runs beside R2 and R3 (messaging, not registry).
- R8 runs beside R6 (scopes, not network).
- R10 runs beside R9 (discovery and statements, not the read procedures).
- R7 runs beside R8 and R9.
- R13 runs beside R6 and later core slices.
- R12 follows R5, since both touch the trierarch and the plugin.
- R11 follows R9, since both change `fleet.ts` guards.

## Kickoff prompt: slice 9 (hardening)

```markdown
# Slice 9: hardening

Start from the latest main. Read CLAUDE.md, docs/decisions/README.md (full files: 0008, 0011), docs/architecture.md (Deployment, security baseline), then the server and web start-up code and both package.json files. Other slices in docs/build-plan.md are context only.

## Goal

The packages, installed from npm on a fresh machine, run a fleet safely. The private infra repo installs `@aeolus-fleet/core` and `@aeolus-fleet/console` at a pinned version and starts them; nothing in it knows this repo's source.

## Build

- Runnable from an install: each package has `bin` commands for what an operator runs (server: start, migrate, fleet init, operator password reset; web: start). All configuration comes from environment variables, documented in each package README.
- The web server reads the Aeolus server address at start-up and passes it to the browser, never at build time.
- Database errors are logged by their code, never by their message, so no request data reaches the log.
- The server commands refuse U+0000 like the API.
- A stopping server ends waiting receives and closes idle connections at once.
- Errors Fastify raises itself (malformed JSON, oversized body, unknown route) use the `{ code, message }` shape.

## How to work

1. Before coding, write a short plan in the PR draft, with any question the docs do not answer. Stop and ask if there are questions.
2. Load the skills CLAUDE.md names. Test first.
3. Keep the slice thin; the rest goes under "Noticed, not done".

## Done when

- A test packs both packages (`npm pack`), installs the tarballs in an empty folder, runs migrate and fleet init through their `bin` commands, starts server and web from there against Postgres, and gets a healthy answer from both.
- Each item above is proven by a test.
- npm run typecheck, npm run lint, npm test green locally and in CI.
- PR description: decisions the docs did not dictate, open questions, noticed not done.
```

## Template: every slice after that

Fill the three bracketed parts from the build plan row. Keep everything else as it is.

```markdown
# Slice [N]: [name]

Read CLAUDE.md, docs/blueprint.md and docs/architecture.md first. Then read the code that already exists for the parts this slice touches. Do not read beyond that.

## Goal

[the "Builds" cell of the build plan]

## How to work

1. Before coding, write a short plan in the PR draft: the use cases, ports and adapters you will add, the tests you will write, and any question the docs do not answer. If there are questions, stop and ask them.
2. Load the skills CLAUDE.md names for the code you touch. Build inside out and test first (red, green, refactor, with the red commits in the history): domain and use case in core, then the Prisma adapter with Testcontainers tests, then the tRPC procedure.
3. Every state change writes its event to the event log in the same transaction.
4. Keep the slice thin. Anything outside it goes into the PR description under "Noticed, not done".

## Done when

[the "Done when" cell of the build plan]
- npm run typecheck, npm run lint and npm test pass locally and in CI.
- PR description: decisions the docs did not dictate, open questions, noticed not done.
```

After each PR: start a fresh session as a reviewer, give it the PR and the slice's "Done when" cell, and ask it to verify each criterion against the code and the test output by name. Merge only after that.
