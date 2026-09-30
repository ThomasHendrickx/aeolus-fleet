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

One session per row, one PR per session, merged before the next starts. Slices 0 to 7 (with 1b, 1c and 6b) are done; git history holds what each built. Slice 8 proves the promise; the deploy follows at once, so Thomas can delegate from one session; the console and the rest come after that.

| # | Slice | Builds | Done when |
| --- | --- | --- | --- |
| 8 | Acceptance | The real starting prompt and MCP instructions; the automated acceptance test over MCP; two real Claude sessions as two ships | See the slice 8 prompt below |

Right after the acceptance test: production hardening (log database errors by code, never by message, so no request data reaches the log; the server commands refuse U+0000 like the API; a stopping server ends waiting receives and closes idle connections at once; errors Fastify raises itself (malformed JSON, oversized body, unknown route) use the `{ code, message }` shape; the web server reads the Aeolus server address at start-up and passes it to the browser, never a build-time setting, so a published web package works on any host), then the private `aeolus-fleet-infra` repo and the Hetzner deploy. Thomas's decision session is then an agent ship (messages only); he commissions and releases ships in the bare console.

Then, in this order: the console in atomic design (set up Storybook first, then atoms to templates, each with a story per meaningful state; live updates over WebSocket subscriptions; first design how a reconnecting browser resumes without missing an event, because event ids are not in commit order under concurrent transactions), retire with the typed confirm (retire locks the ship `FOR NO KEY UPDATE` before abandoning direct deliveries, so a racing send's `FOR SHARE` serialises with it), Needs attention (resend as a new message naming the original, dismiss as a delivery state), the operator inbox (messages to `argo`).

## Kickoff prompt: slice 8 (acceptance)

```markdown
# Slice 8: acceptance

Start from the latest main. Read CLAUDE.md, docs/decisions/README.md (full files: 0001, 0010, 0015), docs/blueprint.md ("Start a session", "Crash recovery", the ship contract) and docs/architecture.md (Testing), then the placeholder starting prompt, the MCP adapter and the tool descriptions. Other slices in docs/build-plan.md are context only.

## Goal

Two real Claude sessions, each given only a starting prompt, join the fleet over MCP and exchange messages; a release mid-delivery loses nothing.

## Build

Three layers, nothing repeated between them:
- Starting prompt (identity only): fleet MCP URL, the one-line command to add it if the session lacks it, ship id, secret, how to pick its location (DEVICE, CLOUD, SERVER, OTHER with a description), and "call register". It says nothing about the ship's work: the operator adds that.
- MCP server instructions (the protocol, sent when a client connects): register once and keep the crew token; the loop (receive, ack each delivery at once, act, answer by `senderName` with `inReplyTo`); keep receiving while waiting for an answer; deregister when the session ends for good.
- Tool descriptions (per-call rules): already there; change only what the two layers above make redundant.

Automated acceptance test over MCP with the official SDK client: two ships exchange messages back and forth; one is released mid-delivery, a new crew registers with a new prompt, and the message is received again; nothing is lost; the event log shows every step.

## How to work

1. Before coding, write a short plan in the PR draft: the text of the starting prompt and the MCP instructions, the tests, and any question the docs do not answer. Stop and ask if there are questions; the text is Thomas's to approve.
2. Load the skills CLAUDE.md names. Test first.
3. Keep the slice thin; the rest goes under "Noticed, not done".

## Done when

- The automated acceptance test passes on CI.
- The PR description holds a runbook Thomas follows by hand: start the fleet, commission two ships, paste each starting prompt plus one sentence of task into its own Claude Code session, watch them exchange messages, release one mid-conversation, crew it again, and see the conversation continue.
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
