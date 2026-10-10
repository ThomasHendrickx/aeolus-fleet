---
name: aeolus-fleet-core
description: Mandatory with domain-modelling and typescript for code under packages/core or packages/common. Layout, contexts and what lint enforces.
---

# Core in aeolus-fleet

Load with `domain-modelling` and `typescript`.

- Layout: `core/{registry,messaging,identity,shared}`, `adapters/{prisma,trpc,http,rest,mcp}`, wiring in `app.ts`. A use-case file is a file in `core` that declares an exported factory named `create<Name>` (like `createPing`).
- Value objects: `ShipName`, `Payload`, `Location`. Events from the blueprint's event table, written through `EventLog`.
- The tenant scope is the fleet; every port method takes it (only exception: decision 0007).
- Ids and Zod schemas live in `common` (`ShipId`, `idSchema`). The tRPC adapter is the API adapter and maps error kinds to API errors.
- A context publishes its port in `public.ts`.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): core imports and purity, context `public.ts`, Prisma and REST/MCP boundaries, a test beside every use case; `any`, casts, `!`, `@ts-ignore`, exhaustive switches, parameter count, boolean names, default exports, file names, no `throw` in core.
