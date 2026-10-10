# Aeolus: guidelines for Claude Code

## What Aeolus is

An agent fleet manager with two promises:
1. A fleet snapshot: which ships exist, what type they are, who crews them.
2. Guaranteed communication: no message is ever lost, and no send returns OK before the message is durably stored. The operator is not the fail-safe.

Aeolus is responsible for distribution, not execution. A ship acknowledges on receipt; what it does next is its own business.

## Source of truth

- docs/blueprint.md: product, language, behaviour.
- docs/architecture.md: stack, packages, code structure, tables.
- docs/build-plan.md: the slice order and what done means for each slice.
- docs/decisions/README.md: every decision in one line. Read it first; open a decision file only for its full rule. Do not reopen a recorded decision; raise it as a question instead. Keep decision files short: current rule, why, rejected. No history (git has it).
- docs/design/README.md: design system (parts, tokens, conventions). Look only; behaviour comes from the blueprint.

Every fact has one source of truth; everything else points to it, never copies it.

If the docs do not answer a behaviour question, stop and ask. Never decide product behaviour yourself.

## House rules

- npm only (npm install, npm run, npm test). Never pnpm or yarn.
- English for all code, names, comments, commits, paths and database fields.
- No em dashes anywhere: code, docs, commits, PR text.
- Use the ubiquitous language from the blueprint (ship, type, crew, lease, commission, release, retire, delivery). Do not invent synonyms.

## Architecture rules

- Packages: @aeolus-fleet/common (schemas, ids), @aeolus-fleet/core, @aeolus-fleet/console, and the optional @aeolus-fleet/squadrons (decision 0017). Separate packages, decided.
- Ports and adapters. core/src/domain holds domain, use cases and ports, with no framework, Prisma, pg or tRPC imports. The lint rule enforces it; never disable it.
- Contexts in core: registry, messaging, identity, shared. A context does not reach into another's internals.
- Prisma lives in src/adapters/prisma only. Locking and notify queries use typed raw SQL there.
- tRPC is the single API door. REST and MCP map onto the same ship procedures; they never hold logic of their own.
- Every table has fleet_id. Every query is scoped by it.
- Ids are prefixed and time-ordered (flt_, shp_, msg_, dlv_, evt_, lse_, crd_, opr_, ses_, lbl_, lbv_, rfs_), from common/src/ids.
- Every caller is a ship. The operator is the ship `argo` (decision 0012). Authorise every call by the caller's scopes, read from the server, never from the request.
- Before 1.0.0 breaking changes are allowed (decision 0013). Keep designs minimal; do not build compatibility layers.
- Every state change writes its event in the same transaction.
- Payloads are at most 64 KB. A message is the travelling ticket; the reference is where the content lives.
- Web follows atomic design: components/atoms, molecules, organisms, templates. shadcn/ui on Base UI for atoms.

## Skills

Load the matching skills from `.claude/skills/` (Codex: `.agents/skills/`) before writing code. They are mandatory, not suggestions:

- `test-driven-development` and `aeolus-fleet-testing`: every code change. Strict red, green, refactor for server and common (decision 0014).
- `domain-modelling` and `aeolus-fleet-core`: anything under `packages/core/src/domain` or `packages/core/src/adapters`.
- `typescript`: every `.ts` or `.tsx` change; with `aeolus-fleet-core` under `packages/core` or `packages/common`.
- `web-frontend` and `aeolus-fleet-console`: anything under `packages/console`.

The `aeolus-fleet-*` skills live here. The others come from ThomasHendrickx/skills, pinned in `skills-lock.json`: never edit them here; change them there, tag a release, then `npx skills@1.7.2 add ThomasHendrickx/skills#<tag> --agent claude-code codex -y`.

## Quality

- npm run typecheck, npm run lint and npm test green before every commit, except a test-driven red commit that only adds the failing test and is labelled `(red)`. Push only a green head. Zero lint errors, no eslint-disable without a comment explaining why.
- Every use case has unit tests with in-memory ports. Every adapter that touches Postgres has a Testcontainers test.
- Delivery guarantees are proven by tests: concurrency, rollback, restart. A guarantee without a test does not exist.
- Report a test as passing only after you saw it run by name.
- No any without a comment explaining why.

## Working

- Done means the acceptance criteria are met. A finding that does not block them is reported, not acted on.
- One slice per session, one PR per slice. Keep the slice thin; list what you noticed but did not do.
- Commit per logical step, not one catch-up commit.
- Repo text must serve the current commit. What git shows (what changed, the steps taken) lives in commits and the PR, never in files. Decisions go into the docs or an ADR as current state.
- Earlier slices are not precedent. Do what the prompt and docs ask, nothing more. New rules, checks, exceptions or process steps come only from Thomas: propose, never add.
- No self-review passes. The one review is a clean-room session after the PR.
