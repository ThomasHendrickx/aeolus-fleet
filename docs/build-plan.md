# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-10-07.

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
