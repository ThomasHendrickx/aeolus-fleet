---
name: domain-modelling
description: Mandatory for code under packages/server/src/core or src/adapters. Where each piece of server logic belongs.
---

# Domain modelling

- Layout: `core/{registry,messaging,identity,shared}`, `adapters/{prisma,trpc,http,rest,mcp}`, wiring in `app.ts`. One file per concept, named in blueprint language (`ship-name.ts`, `commission-ship.ts`), test beside it.
- Value objects (`ShipName`, `Payload`, `Location`): immutable, built only by a validating function returning a result. Trusted afterwards.
- Aggregates: plain data plus pure functions `(state, input) => Result<{ state, events }, DomainError>`. Every blueprint invariant lives here. No ports, no clock, no id generation: use cases pass `now` and ids in. DB constraints are backup only.
- Events: raised by aggregates, names from the blueprint's event table (add a row before inventing one). Written through `EventLog` in the same unit of work.
- Use cases: one file each, factory `createX(deps) => fn` like `createPing`. Load, call aggregate, store, append events, one unit of work. A rule in a use case belongs in the aggregate.
- Ports: interfaces in core, named for the need (`ShipRepository`), every method takes the fleet scope (only exception: decision 0007).
- Adapters translate only. tRPC adapter: parse with `common` schema, resolve caller, check scope, call one use case, map result.
- Contexts talk only through a published port, never each other's aggregates or repositories.
- Caller ship and fleet come from auth, never from the request body.
