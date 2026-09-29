# Registry

Bounded context for fleets, ships and leases: initialise the fleet (with `argo`), commission, claim, release, retire, list the fleet. Domain, use cases and ports only (see docs/architecture.md, "Code structure").

`index.ts` is the published surface: the only module another context may import. Use cases are not part of it; adapters import them from their own modules.
