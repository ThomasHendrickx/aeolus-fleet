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
| 1 | Fleet, `argo` and the console session | Fleet init command creating the fleet and `argo`; scopes and their check on every call; console sign-in exchanging `argo`'s secret for a session cookie (takeover); sign-out; command to replace `argo`'s secret; the event log's shape; health endpoints without fleet data; release tags the commit | See the slice 1 prompt below |
| 2 | Commission a ship | Commission use case (requires `fleet:manage`): name handle rules (`argo` reserved), type, kind `agent` with scopes `messages:send` and `messages:receive`, ship in Awaiting crew; Get starting prompt: new `aeolus_sk_v1_` secret, stored as SHA-256, at most one valid; placeholder prompt (server URL, ship id, secret); a bare unstyled commission page | Invariants tested: unique name among active ships, one valid secret, prompt only while Awaiting crew; events written |
| 3 | Claim | Ship authenticates with its secret and claims the lease, reporting its location (`DEVICE`, `CLOUD`, `SERVER`, or `OTHER` with a description); ship becomes Crewed; lease held indefinitely | Claim with a revoked or unknown secret fails; a claim while another session holds the lease fails; claiming a retired ship fails; events written |
| 4 | Send | Send direct (by id or by name, resolved at send, `argo` included) and by type; the sender is always a ship; optional in-reply-to; message plus deliveries in one transaction; 64 KB limit; NOTIFY on commit | A failed transaction leaves no message and no delivery; name resolution and limit tested |
| 5 | Receive and acknowledge | Long-poll receive (about 25 s) with `FOR UPDATE SKIP LOCKED`, woken by LISTEN; acknowledge on receipt; claim count, undeliverable after 5 claims without ack | Two concurrent receivers never get the same delivery; a delivery is never lost across a server restart |
| 6 | Release and deregister | Operator release ends the lease and invalidates the secret; ship `deregister` ends the session cleanly and releases the lease; direct deliveries back to the inbox, type deliveries back to the type queue with claim history | In-flight deliveries return and are received by the next crew; after a release the old secret fails |
| 7 | MCP and REST | MCP (official SDK, streamable HTTP) and REST with generated OpenAPI, both mapped onto the ship procedures. Ship identity per conversation (decision 0015): the MCP connection carries no ship credential; the `register` tool takes ship id and secret and returns a crew token; every other tool takes the crew token as an argument. Two conversations on one MCP connection crew two different ships, and a second conversation registering an already crewed ship is refused. If slice 3 built `register` without a crew token, add it here for all three doors | A Claude Code session configured with the MCP endpoint can claim, send, receive and ack |
| 8 | Acceptance | Draft the real starting prompt (deferred until now); run two real Claude sessions as two ships | Thomas watches two ships exchange messages back and forth; the event log shows every step |

After the acceptance test, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm, Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`), then the private `aeolus-fleet-infra` repo and the Hetzner deploy.

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
  - `permissions: id-token: write` and `contents: write` (to push the release tag). No `NPM_TOKEN` or any other npm secret.
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

## Kickoff prompt: slice 1 (fleet, `argo` and the console session)

Paste this into a new Claude Code session on the aeolus-fleet repo.

```markdown
# Slice 1: fleet, argo and the console session

Read CLAUDE.md, docs/blueprint.md and docs/architecture.md first, and decisions 0002, 0007, 0010, 0012 and 0013. Then read the code that already exists for the parts this slice touches. Do not read beyond that.

## Goal

A fleet can be initialised, and the operator can sign in to the console as the ship `argo`. Every call is authorised by scopes stored on the server.

## Build

- Schema, in a new migration: remove the operator account tables; add `console_sessions`; add kind (`operator` or `agent`) and scopes to ships; add the event shape (type, time, actor ship or system, ship, message and delivery it concerns, small details); add the lease location (`DEVICE`, `CLOUD`, `SERVER`, `OTHER` plus description); add optional in-reply-to and resend-of on messages; add the dismissed delivery state and a read date. Retire the `opr_` prefix in common.
- Scopes: `messages:send`, `messages:receive`, `fleet:read`, `fleet:manage`. A secret or session lookup returns ship, fleet, kind and scopes in one query (the one lookup not scoped by fleet). The API checks the procedure's required scope before any use case runs.
- Fleet init: a server command (`npm run fleet:init -w @aeolus-fleet/server`) that creates the fleet and `argo` (kind `operator`, all scopes) and prints `argo`'s secret once. It refuses to run when a fleet already exists.
- Replace argo's secret: a server command that invalidates the old secret, prints a new one once, and ends every console session.
- Console sign-in: exchange `argo`'s secret for a random session token, stored as SHA-256, sent as an httpOnly secure SameSite cookie, valid 30 days after last use. Signing in ends the previous console session and takes `argo`'s lease over; its in-flight deliveries return to pending; the secret stays valid. The console session's lease location is `OTHER` with the description `web console`. Rate-limit sign-in.
- Sign-out ends the session and releases `argo`'s lease.
- `argo` can never be retired, released or renamed, and the name `argo` is reserved. Enforce it in the domain; commissioning comes in slice 2, but the rule and its tests belong here.
- Events: fleet initialised, ship commissioned (argo), ship claimed, lease revoked, credential revoked, each in the same transaction as its change.
- Health: server `/health` reports server up and database reachable; web `/health` reports web up and the server's health. Neither says anything about fleets. `system.ping` requires `fleet:read` or is removed; say which you chose and why.
- Web: a sign-in page (paste the secret), a signed-in placeholder page, sign-out. Unstyled; the console design comes later.
- Release: `release.yml` also tags the released commit `v<version>` (needs `contents: write`).

## How to work

1. Before coding, write a short plan in the PR draft: the use cases, ports and adapters you will add, the tests you will write, and any question the docs do not answer. If there are questions, stop and ask them.
2. Build inside out: domain and use case in core with unit tests, then the Prisma adapter with Testcontainers tests, then the tRPC procedure, then the web page.
3. Every state change writes its event in the same transaction.
4. Keep the slice thin. Anything outside it goes into the PR description under "Noticed, not done".

## Done when

- Fleet init creates the fleet and argo once and refuses a second run.
- Sign-in works end to end in a Playwright test; a wrong secret, an expired session and a second sign-in (the first session stops working) are tested.
- A call without the required scope is refused, tested at the API.
- Retiring, releasing or renaming argo is refused, tested in core.
- Replacing argo's secret makes the old one fail and ends every session.
- Health endpoints return no fleet data.
- npm run typecheck, npm run lint and npm test pass locally and in CI.
- A work-history entry exists in docs/work-history/.
- The PR description lists every file created or changed, every decision you made that the docs did not dictate, and every open question.
```

After the PR: start a fresh session as a reviewer, give it the PR and the "Done when" list above, and ask it to verify each item against the code and the test output by name. Merge only after that.

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
- A work-history entry exists in docs/work-history/.
- The PR description lists every file created or changed, every decision you made that the docs did not dictate, and every open question.
```

After each PR: start a fresh session as a reviewer, give it the PR and the slice's "Done when" cell, and ask it to verify each criterion against the code and the test output by name. Merge only after that.
