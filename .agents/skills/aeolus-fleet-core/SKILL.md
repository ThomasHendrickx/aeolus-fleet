---
name: aeolus-fleet-core
description: Mandatory with domain-modelling and typescript for code under packages/core or packages/common. Layout, contexts and what lint enforces.
---

# Core in aeolus-fleet

Load with `domain-modelling` and `typescript`.

- Layout: `src/domain/{registry,messaging,identity,shared}`, technologies in `src/adapters/` (one folder each), use cases wired in `wiring.ts`, the server built in `app.ts`. A use-case file is a file in `src/domain` that declares an exported factory named `create<Name>` (like `createPing`).
- Aggregates: plain data plus pure functions `(state, input) => Result<{ state, events }, DomainError>`; they raise the events. No ports: use cases pass `now` and ids in.
- Value objects, such as the handles in `registry/ship-handle.ts`. Events from the blueprint's event table, written through `EventLog`.
- The tenant scope is the fleet (only exception: decision 0007).
- Ids and Zod schemas live in `common` (`ShipId`, `idSchema`). The tRPC adapter is the API adapter.
- A context publishes its port in `public.ts`; no other barrels in the domain.
- A change to the shape of a public call (what a ship, plugin or app reads or sends) is named under a `Breaking` heading in the PR body, so the release notes carry it.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): core imports and purity, context `public.ts`, Prisma and REST/MCP boundaries, a test beside every use case; `any`, casts, `!`, `@ts-ignore`, exhaustive switches, parameter count, boolean names, default exports, file names, no `throw` in core.
