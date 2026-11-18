# One reachable ship

## Purpose

Let a caller obtain one conversation partner's current name and description without loading the fleet or deciding reach in the gateway. This is the core dependency of [gateway #390](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/390), requested in [#1911](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1911). These are questions for the owner, not approved behavior or an implementation plan.

## Lessons to check against

- The [ship contract](../../guide/ship-contract.md) exposes the same procedures through REST and MCP. Core owns authorization; the gateway must use the caller's identity, never its broader plugin rights.
- The [decision index](../../decisions/README.md), especially [0034](../../decisions/0034-network-rules.md) and [0047](../../decisions/0047-discovery-and-statements.md): discovery needs `messages:send` and current send reach, not `fleet:read`. It reveals ships, never rules, and records nothing. Statements use the crew's version while stated, otherwise the commission note, otherwise null; they are pulled, never pushed. [0059](../../decisions/0059-verified-facts.md) keeps checked claims separate from statements.
- Ship protocol rule 12 tells ships to use `discover` to find destinations and what they offer. Today it returns ships and type counts, excluding self, viewer and retired ships; its implementation reads fleet-wide ships, statements, facts and writer names. Filtering its result still reads the collection. Lookup must check one candidate against the same current reach, without a message's reply exception.
- [Person ship reads](../person-ship-reads/README.md) already records the owner's description choice: first sentence of the crew summary, null when absent, without commission-note fallback. Description and discovery's statement are different projections.
- [0013](../../decisions/0013-breaking-changes-before-1-0.md): breaking changes before 1.0 are allowed; compatibility layers have no purpose here. Performance target: 3,000 ships and 10,000,000 messages per fleet, p95 <100 ms, p99 <500 ms, errors <1%; implementation must measure it, not claim it from this design.

## Questions

**A. Which contract surface?**

1. Add `ship.lookup`, accepting exactly one name or id.
2. Add a single-target mode to `discover`.

**Pick 1:** one resource and one answer, through the shared procedures and both doors. Preserve destination discovery for today's protocol use; no compatibility machinery.

**B. What answer does the header need?**

1. `{ id, name, description }`, using the already approved description rule above.
2. A full discovery ship, including statement, capabilities and verified facts.

**Pick 1:** fetch only the header's fields; reuse the description rule rather than invent another summary. No type counts, reports or writer lookups.

**C. Who is visible, and what does a miss mean?**

1. Require `messages:send`; apply discovery's exclusions and current send reach; return null for absent, excluded or unreachable targets.
2. Return separate not-found and forbidden target errors.

**Pick 1:** reveal no inaccessible target. Invalid input and invalid credentials remain ordinary errors. Read only the fleet-scoped candidate, its current crew summary and the caller/target reach inputs under one rules version, using indexed id/name lookup; never enumerate ships or history. Gateway calls as the person's ship. Previously exchanged messages do not grant current visibility; lookup records nothing and does not guarantee a later send.
