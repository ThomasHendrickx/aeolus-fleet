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

One session per row, one PR per session, merged before the next starts. Slices 0 to 6b (with 1b and 1c) are done; git history holds what each built. Slices 7 and 8 prove the promise; the deploy follows at once, so Thomas can delegate from one session; the console and the rest come after that.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 7 | MCP and REST | `/mcp` tools and `/api/v1` REST with OpenAPI, mapped onto the ship procedures, self-explaining | See the slice 7 prompt below |
| 8 | Acceptance | Draft the real starting prompt (deferred until now); run two real Claude sessions as two ships | Thomas watches two ships exchange messages back and forth; the event log shows every step |

Right after the acceptance test: production hardening (log database errors by code, never by message, so no request data reaches the log; the server commands refuse U+0000 like the API; a stopping server ends waiting receives and closes idle connections at once; the web server reads the Aeolus server address at start-up and passes it to the browser, never a build-time setting, so a published web package works on any host), then the private `aeolus-fleet-infra` repo and the Hetzner deploy. Thomas's decision session is then an agent ship (messages only); he commissions and releases ships in the bare console.

Then, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm (retire locks the ship `FOR NO KEY UPDATE` before abandoning direct deliveries, so a racing send's `FOR SHARE` serialises with it), Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`).

## Kickoff prompt: slice 7 (MCP and REST)

```markdown
# Slice 7: MCP and REST

Start from the latest main. Read CLAUDE.md, docs/decisions/README.md (full files: 0004, 0015), docs/blueprint.md (the ship contract) and docs/architecture.md (doors, `/mcp`, `/api/v1`), then the ship procedures in the tRPC router. Other slices in docs/build-plan.md are context only.

## Goal

An agent reaches its ship through MCP or REST, with no repo to read: the tools and the OpenAPI spec explain themselves.

## Build

- `/mcp`: remote MCP server with the official TypeScript SDK, streamable HTTP. One tool per ship procedure: `register`, `whoami`, `send`, `receive`, `ack`, `deregister`. Each tool calls the tRPC router; no logic of its own.
- Identity per conversation (decision 0015): the connection carries no credential. `register` takes ship id, secret and location and returns the crew token; every other tool takes the crew token as an argument.
- Each tool's description states its rules, because agents read them on every call: ack every delivery right away; `receive` waits up to about 25 s and is safe to call again at once; answer by `senderName`; `inReplyTo` takes the message id, not the delivery id; `idempotencyKey` is a new unique string per message, reused only to retry the same send; the crew token is returned once, keep it.
- Tool errors come back as readable text with their code.
- `/api/v1`: REST for the same ship procedures, crew token as a Bearer header, with an OpenAPI spec generated from the router and served next to it, carrying the same rules in its descriptions.

## How to work

1. Before coding, write a short plan in the PR draft: the adapters you will add, the tests you will write, and any question the docs do not answer. If there are questions, stop and ask them.
2. Load the skills CLAUDE.md names. Test first; the adapters go through the tRPC router (lint enforces it).
3. Keep the slice thin; the rest goes under "Noticed, not done".

## Done when

- Integration, with the official MCP SDK client against a running server: register, send, receive, ack and deregister work; two conversations on one connection crew two different ships; a second register of an already crewed ship is refused with a readable error; a tool call without a valid crew token is refused.
- REST: the same flow with curl-style requests; the OpenAPI spec lists every ship procedure.
- A manual check Thomas can run: a Claude Code session configured with `/mcp` claims a ship from a starting prompt and exchanges messages with another. Put the one-line setup command in the PR description.
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
