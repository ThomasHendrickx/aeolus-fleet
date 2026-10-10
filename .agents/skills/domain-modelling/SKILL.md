---
name: domain-modelling
description: Use for server domain logic, use cases, ports and adapters. Where each piece of server logic belongs.
---

# Domain modelling

Ports and adapters. The domain holds aggregates, use cases and ports, with no framework, ORM, driver or API imports.

- One file per concept, named in domain language (`ship-name.ts`, `commission-ship.ts`), test beside it.
- Value objects: immutable, built only by a validating function returning a result. Trusted afterwards.
- Aggregates: plain data plus pure functions `(state, input) => Result<{ state, events }, DomainError>`. Every invariant lives here. No ports: use cases pass `now` and ids in. DB constraints are backup only.
- Events: raised by aggregates, named from the domain's event list (add one there before inventing one). Written in the same unit of work as the state change.
- Use cases: one file each, factory `createX(deps) => fn`. Load, call aggregate, store, append events, one unit of work. A rule in a use case belongs in the aggregate.
- Ports: interfaces in the domain, named for the need (`ShipRepository`); every method takes the tenant scope.
- Adapters translate only. API adapter: parse with the shared schema, resolve caller, check scope, call one use case, map result.
- Bounded contexts talk only through a published port, never each other's aggregates or repositories.
- Caller and tenant come from auth, never from the request body.
