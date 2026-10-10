# Registry

Bounded context for fleets, ships and leases: initialise the fleet (with `argo`), commission, claim, release, retire, list the fleet. Domain, use cases and ports only (see docs/architecture.md, "Code structure").

`public.ts` is the published surface: the only module another context may import. Use cases are not part of it; adapters import them from their own modules.

The fleet's network settings (decision 0034) live here, as rules select ships by labels: setting the rules, the reach check Messaging asks before it stores a message (`checkReach`, which records a refusal), and argo's read of the refusals.
