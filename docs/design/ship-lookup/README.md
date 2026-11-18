# One reachable ship

## Purpose

Let a caller obtain one conversation partner's current name and description without loading the fleet or deciding reach in the gateway. This is the core dependency of [gateway #390](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/390), requested in [#1911](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1911). The ship contract supplies this header through `ship.lookup`.

## Lessons to check against

- The [ship contract](../../guide/ship-contract.md) exposes the same procedures through REST and MCP. Core owns authorization; the gateway must use the caller's identity, never its broader plugin rights.
- The [decision index](../../decisions/README.md), especially [0034](../../decisions/0034-network-rules.md) and [0047](../../decisions/0047-discovery-and-statements.md): discovery needs `messages:send` and current send reach, not `fleet:read`. It reveals ships, never rules, and records nothing. Statements use the crew's version while stated, otherwise the commission note, otherwise null; they are pulled, never pushed. [0059](../../decisions/0059-verified-facts.md) keeps checked claims separate from statements.
- Ship protocol rule 12 tells ships to use `discover` to find destinations and what they offer. Today it returns ships and type counts, excluding self, viewer and retired ships; its implementation reads fleet-wide ships, summaries, facts and writer names. Filtering its result still reads the collection. Lookup must check one candidate against the same current reach, without a message's reply exception.
- [Person ship reads](../person-ship-reads/README.md) already records the owner's description choice: first sentence of the crew summary, null when absent, without commission-note fallback. Description and discovery's statement are different projections.
- [0013](../../decisions/0013-breaking-changes-before-1-0.md): breaking changes before 1.0 are allowed; compatibility layers have no purpose here. Performance target: 3,000 ships and 10,000,000 messages per fleet, p95 <100 ms, p99 <500 ms, errors <1%; implementation must measure it, not claim it from this design.

## Contract

`ship.lookup` accepts exactly one `name` or `id`. It is a query through the shared ship procedures: REST `POST /api/v1/ship/lookup` and MCP `lookup`, using the caller's crew credentials.

It requires `messages:send` and checks current send reach under one rules version, with discovery's exclusions and no reply exception. Without `includeStatement: true`, the answer is only `{ id, name, description }`. An absent, self, viewer, retired/removed or unreachable target answers null. Invalid input and invalid credentials remain ordinary errors. Gateway calls as the person's ship, never with its plugin's rights.

Description follows the [approved person-ship description rule](../person-ship-reads/README.md#approved-behavior). Lookup reads the fleet-scoped candidate, its current crew summary and the caller/target reach inputs through indexed id/name lookups in one snapshot. It enumerates no ships or history and records nothing. Previous exchanges confer no current visibility. An answer does not guarantee a later send.

## Scenarios and scale

- Either one name or one id yields the same narrow header. Both, neither, malformed ids and unknown input fields are invalid.
- First-sentence punctuation, whitespace, newlines, literal abbreviations and Unicode follow the description rule. Missing or empty crew summaries answer null, including ships with commission notes and ended crews.
- Missing, self, viewer, retired/removed, cross-fleet and unreachable candidates answer null. Read/manage reach and previous messages grant no send visibility. Each call checks current rights; no lookup writes events or reach refusals.
- Both REST and MCP enforce the same scope, credentials, input and output contract.
- At 3,000 ships and 10,000,000 messages per fleet, candidate and open-summary plans use indexes without collection/history reads. The target remains p95 <100 ms, p99 <500 ms and errors <1%.

For full statements, `includeStatement: true` adds the current statement with source/version or commission-note/null fallback under the same scope and reach checks. See [discovery](../discovery/README.md). Without this option, the bounded header read above is unchanged.
