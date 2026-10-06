# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-10-06.

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

## Epic: the trierarch plugin

What the trierarch plugin and a trierarch do is in [trierarch.md](trierarch.md), their build in the architecture ("The trierarch"), and why in decisions 0026 to 0029. The 0.17 trierarch (slices D1 to D6, a wanted list edited by messages) is done; git holds what each built. This epic replaces how it gets its work. One PR per slice, labelled with its release.

Before it, built in the fleet core: the report's details (#248) and the crew request with `crew:assign` and `crew:run` (#263). Build order: T1, T2, T3, T4, then T5. Labels (#102) steer placement once they are designed; until then placement reads the reports. The console's screens (core crew request screens, the plugin's section beside Squadrons) are their own design pass and not in this epic. The open questions at the end of trierarch.md are answered before the slice that needs them.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| T1 | The plugin's package and a machine joining | The plugin's package, `bin` and lint boundaries as in squadrons; its own database; a connection per fleet and the switch per fleet, as squadrons'. Join: commission a ship of type `trierarch` with `crew:run` and answer its starting prompt. The trierarch's report details schema in `common`, and the trierarch reporting them (harnesses with options and flags, workspaces, caps, kept, orphans, version). `aeolus-trierarch init` takes the plugin's starting prompt | Strict TDD. Join commissions a ship with exactly `crew:run`, type `trierarch`, and answers its starting prompt; it refuses for a fleet that is off or not connected. The details schema takes the example in trierarch.md and refuses unknown fields. A trierarch reports details matching its configuration. A Testcontainers test: a machine joins against a real server and its report reaches the plugin |
| T2 | Assignment | Placement (pure) and the loop that claims: each unassigned request, the trierarchs that fit (harness, workspace, options valid against the schema, room), the claim by `crew:assign`; silent trierarchs with ships assigned flagged for the operator | Strict TDD. Unit tests: a request goes only to a trierarch that offers its harness and workspace, takes its options and has room; none fits leaves it unassigned; a crewed ship is never assigned; a lost claim is read again, never an error; a silent trierarch is flagged and its requests stay. A Testcontainers test: two plugin passes race for one request and exactly one assignment is stored |
| T3 | The trierarch as launcher | The trierarch reconciles from the requests assigned to it, crews with `crew:run`, writes each request's status and confirms a release. Its wanted list, applied message ids and message handling go | Strict TDD. Unit tests for every row of trierarch.md's lifecycle table and every gap rule, with status written for each. A Testcontainers test: an assigned request on a real server is crewed, its status reads running, and removing it ends the lease, removes a clean worktree and makes the request disappear |
| T4 | Retiring the messages | The 0.17 protocol goes: describe, want, release, list and the notices, their schemas in `common` and their test, trierarch.md's section "The 0.17 protocol, until T4", and `fleet:crew` wherever the crew request slice left it. The package README follows | No code, schema or doc names a 0.17 trierarch message or `fleet:crew`. Typecheck, lint and tests green |
| T5 | Migration on Thomas's Mac | No new code unless the migration needs it | Written up in the PR: the 0.17 trierarch's ships listed; the plugin connected; the machine joined with a new trierarch ship; each ship that was wanted has a crew request, assigned to it and running; the old trierarch ship released and retired; a message wakes a migrated session; release removes a clean worktree and keeps one with changes |

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
