# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-09-29.

This plan takes aeolus-fleet from an empty repo to the v1 acceptance test (two ships exchange messages back and forth) in nine Claude Code sessions, one PR each. Session 1 uses the kickoff prompt below; every session after it uses the slice template.

| Who | Owns |
| --- | --- |
| Thomas (operator) | Scope, behaviour, every merge, every question the docs do not answer |
| Claude Code (per session) | Discovery in the repo, implementation, tests, the PR and its description |
| A clean-room reviewer (fresh session) | Reading the PR against the slice's done criteria before merge |

[blueprint.md](blueprint.md) and [architecture.md](architecture.md) are the source of truth, and [decisions/](decisions/) records why. When a session finds a gap, it stops and asks; it never fills the gap with its own guess. The design canvas is look and feel only ([design.md](design.md)).

## Still to do outside the code (Thomas)

- [ ] Branch protection on main: PR required, CI must pass (once CI exists after slice 0)
- [x] Claim the npm org `aeolus-fleet`
- [x] Publish `0.0.0` placeholders for `@aeolus-fleet/server`, `@aeolus-fleet/web`, `@aeolus-fleet/common`
- [x] Configure trusted publishing (OIDC) for the three packages: GitHub Actions, repo `ThomasHendrickx/aeolus-fleet`, workflow `release.yml`
- [x] Publishing access on all three packages: require two-factor authentication and disallow tokens

## The build plan

One session per row, one PR per session, merged before the next starts. Slices 1 to 8 prove the promise; the console and the rest come after the acceptance test passes.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 0 | Walking skeleton | npm workspaces (`common`, `server`, `web`), Node 26, TypeScript strict, ESLint with the core import-boundary rule, Vitest, Prisma schema for the core tables with `fleet_id`, Testcontainers Postgres, Fastify with `/health` and one tRPC procedure, a Next.js page calling it, GitHub Actions CI, the `release.yml` publish workflow | CI green on the PR; one request goes browser to database and back; a test proves `core` cannot import Prisma or Fastify; `release.yml` exists and `npm publish --dry-run` passes for all three packages in CI |
| 1 | Fleet and operator | Fleet init script that creates the fleet and the operator (Argon2id), sign-in, server-side session cookie, `npm run reset-operator-password` | Sign-in works end to end in a Playwright test; wrong password and expired session are tested |
| 2 | Commission a ship | Commission use case: name handle rules, type, ship in Awaiting crew; Get starting prompt: new `aeolus_sk_v1_` secret, stored as SHA-256, at most one valid; placeholder prompt (server URL, ship id, secret); a bare unstyled commission page | Invariants tested: unique name among active ships, one valid secret, prompt only while Awaiting crew; events written |
| 3 | Claim | Ship authenticates with its secret and claims the lease; ship becomes Crewed; lease held indefinitely | Claim with a revoked or unknown secret fails; a claim while another session holds the lease fails; claiming a retired ship fails; events written |
| 4 | Send | Send direct (by id or by name, resolved at send) and by type; message plus deliveries in one transaction; 64 KB limit; NOTIFY on commit | A failed transaction leaves no message and no delivery; name resolution and limit tested |
| 5 | Receive and acknowledge | Long-poll receive (about 25 s) with `FOR UPDATE SKIP LOCKED`, woken by LISTEN; acknowledge on receipt; claim count, undeliverable after 5 claims without ack | Two concurrent receivers never get the same delivery; a delivery is never lost across a server restart |
| 6 | Release and deregister | Operator release ends the lease and invalidates the secret; ship `deregister` ends the session cleanly and releases the lease; direct deliveries back to the inbox, type deliveries back to the type queue with claim history | In-flight deliveries return and are received by the next crew; after a release the old secret fails |
| 7 | MCP and REST | MCP (official SDK, streamable HTTP) and REST with generated OpenAPI, both mapped onto the ship procedures | A Claude Code session configured with the MCP endpoint can claim, send, receive and ack |
| 8 | Acceptance | Draft the real starting prompt (deferred until now); run two real Claude sessions as two ships | Thomas watches two ships exchange messages back and forth; the event log shows every step |

After the acceptance test, in this order: the console in atomic design (atoms to templates, live updates over WebSocket subscriptions), retire with the typed confirm, Needs attention, the operator inbox, then the private `aeolus-fleet-infra` repo and the Hetzner deploy.

A second claim while a lease is held is rejected (blueprint, ship contract: `register` fails if another session holds a live lease). The operator frees the ship with Release.

## Kickoff prompt: session 1 (walking skeleton)

Paste this into a new Claude Code session on the aeolus-fleet repo. It builds the frame only: no product behaviour yet.

```markdown
# Slice 0: walking skeleton

You are building the first slice of Aeolus, an agent fleet manager. Read these first, in this order, before writing any code:

1. CLAUDE.md
2. docs/blueprint.md (what the product is and its language)
3. docs/architecture.md (stack, packages, code structure, core tables)

## Goal

A walking skeleton: every layer exists, is wired, and is proven by a test and by CI. No product behaviour.

## Build

- npm workspaces with three packages: @aeolus-fleet/common, @aeolus-fleet/server, @aeolus-fleet/web. Node 26, TypeScript strict everywhere.
- The folder structure from the "Code structure" section of docs/architecture.md, with empty folders kept by a short README where needed.
- ESLint with an import-boundary rule: nothing under server/src/core may import Prisma, pg, Fastify, tRPC or any adapter.
- common: the prefixed id module (flt_, shp_, msg_, dlv_, evt_; time-ordered) with unit tests, and one Zod schema used by the procedure below.
- server: Prisma schema for the core tables named in docs/architecture.md, every table with fleet_id, prefixed ids as primary keys. One initial migration. Fastify with /health and the tRPC adapter serving one procedure (system.ping, returns server time and the fleet count from the database).
- Tests: Vitest for unit tests; Testcontainers Postgres for one integration test that runs the migration and calls system.ping.
- web: Next.js App Router page that calls system.ping through the tRPC client and shows the result. No styling work.
- GitHub Actions: install, typecheck, lint, unit and integration tests on every PR.
- The release workflow, `.github/workflows/release.yml`. The file name is fixed: npm trusted publishing for all three packages is configured for exactly this name, and it is the only way the packages can be published (tokens are disallowed). Requirements:
  - Triggered manually (`workflow_dispatch`) with a version input. Never on push.
  - `permissions: id-token: write` and `contents: read`. No `NPM_TOKEN` or any other npm secret.
  - Node 26 with npm 11.5.1 or later (upgrade npm in the job if the bundled one is older).
  - Runs typecheck, lint and tests, sets the same version in all three packages, builds, then publishes common, server and web in that order with `npm publish --access public`. Provenance is automatic.
  - Every package.json keeps `repository.url` = `git+https://github.com/ThomasHendrickx/aeolus-fleet.git` with its `directory`; trusted publishing fails without an exact match.
  - The first real version is 0.1.0 (0.0.0 is the name placeholder already on npm).
  - Do not run it. Thomas triggers the first release.

## Out of scope

Auth, ships, messages, MCP, REST, the console, Docker, deployment and an actual release. If you think one of these is needed now, stop and ask.

## Done when

- npm run typecheck, npm run lint and npm test pass locally and in CI.
- A test proves the boundary rule fails when core imports Prisma.
- `release.yml` meets the requirements above; a CI job runs `npm publish --dry-run` for all three packages.
- The web page shows the ping result from a running server and database.
- A work-history entry exists in docs/work-history/.
- The PR description lists every file created and what each is for, and every question you could not answer from the docs.

When a behaviour question is not answered by the docs, ask. Do not decide it.
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
2. Build inside out: domain and use case in core with unit tests, then the Prisma adapter with Testcontainers tests, then the tRPC procedure.
3. Every state change writes its event to the event log in the same transaction.
4. Keep the slice thin. Anything outside it goes into the PR description under "Noticed, not done".

## Done when

[the "Done when" cell of the build plan]
- npm run typecheck, npm run lint and npm test pass locally and in CI.
- A work-history entry exists in docs/work-history/.
- The PR description lists every file created or changed, every decision you made that the docs did not dictate, and every open question.
```

After each PR: start a fresh session as a reviewer, give it the PR and the slice's "Done when" cell, and ask it to verify each criterion against the code and the test output by name. Merge only after that.
