---
name: domain-modelling
description: MANDATORY before writing or changing anything under packages/server/src/core or packages/server/src/adapters. How Aeolus models its domain in code (contexts, aggregates, value objects, domain events, use cases, ports, adapters) and where each piece of logic belongs.
---

# Domain modelling in Aeolus

The server is ports and adapters around three bounded contexts. The blueprint (`docs/blueprint.md`) owns the language and the rules; this skill says how they become code. If the blueprint does not answer a behaviour question, stop and ask. Never invent a rule.

## Where things live

```
packages/server/src/
  core/
    registry/      ships, leases, argo, fleet snapshot
    messaging/     messages, deliveries, selectors
    identity/      credentials, console sessions, scopes
    shared/        fleet scope, unit of work, event log, clock, id generator
  adapters/
    prisma/        repositories and raw SQL implementing core ports
    trpc/          procedures: parse input, check scope, call one use case, map the result
    http/          Fastify host for tRPC, REST and MCP
    rest/, mcp/    mapped onto the ship procedures, no logic of their own
  app.ts           composition: builds adapters and injects them into use cases
```

Inside a context, one file per concept, named after it in the ubiquitous language: `ship.ts`, `ship-name.ts`, `commission-ship.ts`, `ship-repository.ts`. Tests sit next to the file: `ship.test.ts`.

## The building blocks

**Value objects** hold one validated value and are immutable. Construct them only through a function that validates and returns a result: `ShipName`, `ShipType`, `Payload`, `Location`, `Scope`. After construction the value is trusted; nobody re-validates it.

**Aggregates** guard their own invariants. An aggregate is a plain object type plus pure functions that take the current state and return the new state and the events it raised, or a domain error. Example shape:

```ts
export function release(ship: Ship, now: Date): Result<{ ship: Ship; events: ShipEvent[] }, ReleaseError>
```

- Every invariant in the blueprint's "Aggregates and invariants" table is enforced inside its aggregate, not in a use case, not in a procedure, not in the database alone. Database constraints are a second line, never the only one.
- Aggregates never call ports, never read the clock and never generate ids: the use case passes `now` and new ids in.
- One transaction changes one aggregate, unless the blueprint says otherwise (send creates a message and its deliveries together).

**Domain events** are raised by the aggregate as data and written by the use case through the `EventLog` port in the same unit of work. Event names come from the blueprint's event table; add a row there before inventing a new one. Event shape: type, time, actor ship (or system), the ship, message and delivery it concerns, small details.

**Use cases** are the inbound ports. One file per use case, a factory that takes its dependencies and returns a function, matching `createPing` in `core/shared/ping.ts`:

```ts
export function createCommissionShip(deps: { ships: ShipRepository; events: EventLog; unitOfWork: UnitOfWork; clock: Clock; ids: IdGenerator }): CommissionShip
```

A use case is thin: load, call the aggregate, store, append events, all inside one unit of work. If a use case holds a rule, move the rule into the aggregate or a value object.

**Outbound ports** are interfaces declared in core, next to the use case that needs them, named after what the core needs (`ShipRepository`, `EventLog`, `Notifier`), not after the technology. Every port method takes the fleet scope; no port method can read across fleets, except the secret and session lookups decided in decision 0007.

**Adapters** implement ports and translate: Prisma rows to domain types and back, tRPC input to use-case input, domain errors to API errors. An adapter never decides anything the blueprint would call a rule.

## Rules between contexts

- A context imports another context only through that context's published port (for example Messaging asking Registry to resolve a selector). Never its aggregates, never its repositories.
- Shared types that every context needs (ids, fleet scope, clock, events) live in `core/shared`.
- `@aeolus-fleet/common` holds what crosses the wire: Zod schemas for procedure input and output, ids. Domain types stay in core; adapters map between the two.

## Authorisation

Every caller is a ship. The tRPC adapter resolves the caller (secret or console session), reads its scopes from the server, and checks the procedure's required scope before the use case runs. Use cases receive the caller's ship and fleet as input; they never trust a ship id or fleet id from the request body.

## Decision checklist

1. Which context owns this noun? If two contexts both want to change it, one of them is wrong.
2. Is it a rule? It goes in the aggregate or value object, with a unit test.
3. Is it orchestration (load, change, store, publish)? It goes in the use case.
4. Is it translation or technology? It goes in an adapter.
5. Does the core now import anything from `adapters`, Prisma, pg, Fastify or tRPC? The lint rule will fail; fix the design, never the rule.
