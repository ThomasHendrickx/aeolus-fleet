---
name: aeolus-fleet-core
description: Mandatory with domain-modelling and typescript for code under packages/core or packages/common. Layout, contexts and what lint enforces.
---

# Core in aeolus-fleet

Load with `domain-modelling` and `typescript`.

- Layout: `core/{registry,messaging,identity,shared}`, `adapters/{prisma,trpc,http,rest,mcp}`, wiring in `app.ts`. A use-case file is a file in `core` that declares an exported factory named `create<Name>` (like `createPing`).
- Aggregates: plain data plus pure functions `(state, input) => Result<{ state, events }, DomainError>`; they raise the events. No ports: use cases pass `now` and ids in.
- Value objects: `ShipName`, `Payload`, `Location`. Events from the blueprint's event table, written through `EventLog`.
- The tenant scope is the fleet (only exception: decision 0007).
- Ids and Zod schemas live in `common` (`ShipId`, `idSchema`). The tRPC adapter is the API adapter.
- A context publishes its port in `public.ts`; no other barrels in the domain.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): core imports and purity, context `public.ts`, Prisma and REST/MCP boundaries, a test beside every use case; `any`, casts, `!`, `@ts-ignore`, exhaustive switches, parameter count, boolean names, default exports, file names, no `throw` in core.
