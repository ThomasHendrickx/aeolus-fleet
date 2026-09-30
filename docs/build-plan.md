# Aeolus: build plan

Owner: Thomas Hendrickx. Last updated 2026-09-30.

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

One session per row, one PR per session, merged before the next starts. Slices 0 to 5 (with 1b and 1c) are done; git history holds what each built. Slices 5 to 8 prove the promise; the console and the rest come after the acceptance test passes.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 6 | Release and deregister | Operator release and ship `deregister` both end the lease and invalidate the secret; direct deliveries back to the inbox, type deliveries back to the type queue with claim history | See the slice 6 prompt below |
| 7 | MCP and REST | MCP (official SDK, streamable HTTP) and REST with generated OpenAPI, both mapped onto the ship procedures. Ship identity per conversation (decision 0015): the MCP connection carries no ship credential; the `register` tool takes ship id and secret and returns a crew token; every other tool takes the crew token as an argument. Two conversations on one MCP connection crew two different ships, and a second conversation registering an already crewed ship is refused. If slice 3 built `register` without a crew token, add it here for all three doors | A Claude Code session configured with the MCP endpoint can claim, send, receive and ack |
| 8 | Acceptance | Draft the real starting prompt (deferred until now); run two real Claude sessions as two ships | Thomas watches two ships exchange messages back and forth; the event log shows every step |

After the acceptance test, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm (retire locks the ship `FOR NO KEY UPDATE` before abandoning direct deliveries, so a racing send's `FOR SHARE` serialises with it), Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`), then the private `aeolus-fleet-infra` repo and the Hetzner deploy (production hardening first: log database errors by code, never by message, so no request data reaches the log; the server commands refuse U+0000 like the API; a stopping server ends waiting receives and closes idle connections at once; the web server reads the Aeolus server address at start-up and passes it to the browser, never a build-time setting, so a published web package works on any host).

## Kickoff prompt: slice 6 (release and deregister)

```markdown
# Slice 6: release and deregister

Start from the latest main. Read CLAUDE.md, docs/decisions/README.md (full files: 0010, 0012, 0015), docs/blueprint.md (Lease, Ship credential, delivery state diagram, "Crash recovery", the ship contract) and docs/architecture.md ("How the delivery guarantee is implemented", step 4), then the code that already exists for the parts this slice touches. Other slices in docs/build-plan.md are context only.

## Goal

A lease ends cleanly, by the operator or by the ship itself, and nothing in flight is lost: the next crew receives it.

## Build

- `release(shipId)`: requires `fleet:manage`. Refused for `argo` and for a ship that no session crews (awaiting crew or retired); an unclaimed prompt is replaced with a new prompt, not released.
- `deregister()`: the calling ship ends its own lease, authenticated by crew token.
- Both, in one transaction: close the lease, invalidate the secret, end the crew token, return the lease's in-flight deliveries to pending (direct to the ship's inbox; type deliveries lose their claim and go back to the type queue; attempts kept). Events: `LeaseRevoked` (who ended it: operator or ship), `CredentialRevoked`, one per returned delivery.
- The old crew token fails on its next call; a receive waiting for that crew returns without deliveries and never blocks the release.
- Console: a bare Release button per crewed ship on the fleet list, with a normal confirm. No styling; the console work comes later.

## How to work

1. Before coding, write a short plan in the PR draft: the use cases, ports and adapters you will add, the tests you will write, and any question the docs do not answer. If there are questions, stop and ask them.
2. Load the skills CLAUDE.md names. Test first (red, green, refactor); build inside out: core, Prisma adapter with Testcontainers, tRPC procedure, web.
3. Keep the slice thin; the rest goes under "Noticed, not done".

## Done when

- Core tests: every refusal above; release and deregister return in-flight deliveries and keep attempts.
- Integration: after a release or deregister the old secret fails on `register` and the old crew token fails on every call; a delivery in flight at release is received by the next crew (new prompt, new register); a type delivery in flight at release is received by another ship of that type; a release racing a receive never leaves a delivery claimed by an ended lease; a release while a receive waits completes promptly.
- Playwright: release a crewed ship from the fleet list; it shows Awaiting crew.
- npm run typecheck, npm run lint, npm test green locally and in CI, guardrails included.
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
