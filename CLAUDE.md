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
- docs/decisions/: why things are the way they are. Do not reopen a recorded decision; raise it as a question instead.
- docs/design.md: the design canvas, look and feel only. Behaviour comes from the blueprint.

If the docs do not answer a behaviour question, stop and ask. Never decide product behaviour yourself.

## House rules

- npm only (npm install, npm run, npm test). Never pnpm or yarn.
- English for all code, names, comments, commits, paths and database fields.
- No em dashes anywhere: code, docs, commits, PR text.
- Use the ubiquitous language from the blueprint (ship, type, crew, lease, commission, release, retire, delivery). Do not invent synonyms.

## Architecture rules

- Packages: @aeolus-fleet/common (schemas, ids), @aeolus-fleet/server, @aeolus-fleet/web. Separate packages, decided.
- Ports and adapters. server/src/core holds domain, use cases and ports, with no framework, Prisma, pg or tRPC imports. The lint rule enforces it; never disable it.
- Contexts in core: registry, messaging, identity, shared. A context does not reach into another's internals.
- Prisma lives in src/adapters/prisma only. Locking and notify queries use typed raw SQL there.
- tRPC is the single API door. REST and MCP map onto the same ship procedures; they never hold logic of their own.
- Every table has fleet_id. Every query is scoped by it.
- Ids are prefixed and time-ordered (flt_, shp_, msg_, dlv_, evt_, lse_, crd_, opr_, ses_), from common/src/ids.
- Every state change writes its event in the same transaction.
- Payloads are at most 64 KB. A message is the travelling ticket; the reference is where the content lives.
- Web follows atomic design: components/atoms, molecules, organisms, templates. shadcn/ui on Base UI for atoms.

## Quality

- npm run typecheck, npm run lint and npm test green before every commit. Zero lint errors, no eslint-disable without a comment explaining why.
- Every use case has unit tests with in-memory ports. Every adapter that touches Postgres has a Testcontainers test.
- Delivery guarantees are proven by tests: concurrency, rollback, restart. A guarantee without a test does not exist.
- Report a test as passing only after you saw it run by name.
- No any without a comment explaining why.

## Working

- One slice per session, one PR per slice. Keep the slice thin; list what you noticed but did not do.
- Commit per logical step, not one catch-up commit.
- Every session ends with docs/work-history/YYYY-MM-DD.<slice-name>.md: the prompt, every file touched, key decisions.
