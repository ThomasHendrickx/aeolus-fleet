# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-10-05.

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
- [x] Publish `0.0.0` placeholders for `@aeolus-fleet/server`, `@aeolus-fleet/web`, `@aeolus-fleet/common`
- [x] Configure trusted publishing (OIDC) for the three packages: GitHub Actions, repo `ThomasHendrickx/aeolus-fleet`, workflow `release.yml`
- [x] Publishing access on all three packages: require two-factor authentication and disallow tokens

## The build plan

One session per row, one PR per session, merged before the next starts. Slices 0 to 8 (with 1b, 1c, 6b and 8b) are done; git history holds what each built. Now: hardening, release `0.1.0`, then the deploy in the private `aeolus-fleet-infra` repo (in parallel) at `fleet.aeolus-fleet.dev`; the console and the rest come after that.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 9 | Hardening | Production readiness of the packages as installed from npm | See the slice 9 prompt below |

After hardening: Thomas runs the Release workflow for `0.1.0`; the infra repo deploys that version. Thomas's decision session is an agent ship (messages only); he commissions and releases ships in the bare console.

Then, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm (retire locks the ship `FOR NO KEY UPDATE` before abandoning direct deliveries, so a racing send's `FOR SHARE` serialises with it), Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`).

## Epic: the trierarch

What a trierarch does is in [trierarch.md](trierarch.md), its build in the architecture ("The trierarch"), and why in decisions 0002, 0026 and 0027. One PR per slice, labelled with its release.

Build order: D1, D3, D2a, D2b, D4, then D5, which does not block v1. D2b's Claude Code adapter needs D3's identity line and turn marker. D6, Codex as the second harness, follows D4.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| D1 | `fleet:crew` and the protocol schemas | `fleet:crew` in `common`'s scopes and fleet scopes. The server takes it for `fleet.ship`, `fleet.getStartingPrompt` and `fleet.release` (tRPC, REST, MCP) and for nothing else. The console's commission dialog offers it. The trierarch protocol and configuration schemas in `common`, the want's optional `squadron` (a squadron id) among them | Strict TDD. A ship with only `fleet:crew` reads one ship, gets a starting prompt and releases, and every other fleet procedure refuses it (`FORBIDDEN`), each through tRPC, REST and MCP. Commissioning with `fleet:crew` stores it. The protocol schemas take every example in trierarch.md, a want with and without `squadron`, and refuse unknown fields. Typecheck, lint and tests green |
| D3 | The plugin, for a trierarch's sessions | `aeolus-identity.sh write` keeps `wakeBy=trierarch` when asked. With it, the SessionStart and Stop hooks and the watcher guard ask for no watcher. UserPromptSubmit and Stop hooks write the turn marker (busy or idle, with when) | Plugin tests: a folder with `wakeBy=trierarch` gets no watcher from any hook, and the turn marker reads busy during a turn and idle after it. Claude Code and Codex alike where the hook exists. A folder without the line behaves as today |
| D2a | The trierarch's core | `packages/trierarch`: package, `bin`, lint boundaries as in squadrons. Core: WantedList, Reconciler, RestartPolicy and the entry states, with in-memory ports for fleet, harness, processes, workspace and state | Strict TDD. Unit tests for every row of trierarch.md's lifecycle table and every gap rule: idempotent by message id, saved before ack, saved as crewing before register, a lost register reply releases and crews again while a ship crewed by another session is refused, the squadron passed to the identity, refused with the field named, the restart budget, drop on lease ended, strays stopped, orphans reported and never deleted, dirty worktrees kept |
| D2b | The trierarch's adapters and command | The REST fleet client (its own crew token and `fleet:crew`), tmux, git worktree and folder, the Claude Code harness, the JSON state store, and `aeolus-trierarch init`, `run`, `config check` and `install` (a launchd agent, and a systemd user unit if cheap) | A Testcontainers test: a want on a real server crews the ship and writes its identity, and release ends the lease. Adapter tests against real tmux and git in a temporary folder. `config check` prints the effective flags. The README says how to install and configure it |
| D4 | The trial on the Mac mini | No new code unless the trial needs it | Written up in the PR:<br>- a want crews a ship unattended;<br>- a killed pane comes back with no new secret;<br>- a message wakes an idle session;<br>- a restart of the Mac brings the ships back under launchd;<br>- release removes a clean worktree and keeps one with changes.<br><br>It also answers whether Claude Code's folder trust and the one-time skip-permissions acceptance can be given ahead of time, and how; if they cannot, it says so as a finding |
| D5 | The console's trierarch screens | The screens on the design canvas (https://claude.ai/artifact/Wq1HqccJjQtwNyd6KvuSHg): the page "Trierarchs" (TriOverview, TriDetail, the TriStart states, TriCommissionStart, the TriShip states, the TriRelease states, TriAttention, TriNoticeLease) and "Trierarch parts" on the Design system page. Look only; behaviour comes from trierarch.md. Needs its own design pass first for what the screens show beyond D1 | Its design pass answers how the console reads trierarch state, and the screens follow it with a story per meaningful state and an end-to-end test for start and release |
| D6 | Codex as the second harness | The codex harness adapter (launch with the prompt before the flags and always `--no-daemon`, `codex resume --last` on a restart, wake typed as `$aeolus-wake`), the identity and turn marker through the aeolus plugin for Codex, an adapter per configured harness, and `init` answering Codex's one-time questions (folder trust, the aeolus hooks) through `codex app-server` | Adapter tests for launch, restart and wake, and for the setup against a stand-in app server; `init` tests for Codex. Written up in the PR, on the Mac mini: a want with harness `codex` crews a fresh ship that reports unattended, a message wakes it, a killed pane comes back, and release cleans up |

Later, each with its own design pass: pi and herdr adapters; squadrons' setups; a batched inbox for many ships.

## Kickoff prompt: slice 9 (hardening)

```markdown
# Slice 9: hardening

Start from the latest main. Read CLAUDE.md, docs/decisions/README.md (full files: 0008, 0011), docs/architecture.md (Deployment, security baseline), then the server and web start-up code and both package.json files. Other slices in docs/build-plan.md are context only.

## Goal

The packages, installed from npm on a fresh machine, run a fleet safely. The private infra repo installs `@aeolus-fleet/server` and `@aeolus-fleet/web` at a pinned version and starts them; nothing in it knows this repo's source.

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
