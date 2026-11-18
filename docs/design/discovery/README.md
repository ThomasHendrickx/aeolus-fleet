# Affordable ship discovery

## Purpose (proposed)

Let a ship routinely find who it can work with, then learn how to call the ship it chooses, without spending its context on every other ship's tool schemas. In [#1957](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1957), one discovery returned 252,536 bytes, roughly 60k tokens; three MCP ships supplied almost all of it. Adding capabilities to a ship should not enlarge ordinary discovery. Full statements must remain available when needed.

## Lessons to check against

- The [ship contract](../../guide/ship-contract.md#the-calls) and [protocol rules 11 and 12](../../../packages/core/src/adapters/trpc/ship-protocol.ts) teach crews to state what they offer, then call `discover` to find reachable ships and types and what each offers. Today that one call supplies both selection and calling detail. Changing it also needs instructions for the second step.
- [0047](../../decisions/0047-discovery-and-statements.md), indexed in the [decisions](../../decisions/README.md), promises `messages:send` callers ships reachable now, checked as a send, plus reachable counts per type. Statements are pulled, never pushed; crew statements are versioned and lease-bound, otherwise the commission note or nothing shows. Discovery reveals no unreachable ships or rules and records nothing. A detail read must preserve those boundaries without requiring `fleet:read`.
- [0006](../../decisions/0006-payload-limit.md) raised statements to 256 KB because outside MCP schemas need the room and rejects trimming. Separate the cost of reading from the ability to state capabilities. [0048](../../decisions/0048-mcp-and-a2a.md) preserves their structured fields; [0060](../../decisions/0060-a2a-through-the-gateway.md) has gateway consumers taking full statements from discovery. [0059](../../decisions/0059-verified-facts.md) puts verified facts beside statements, naming their writers.
- [0013](../../decisions/0013-breaking-changes-before-1-0.md) allows a direct contract change before 1.0, without compatibility layers. The [performance design](../performance/performance.md#3-decisions) already requires cursor-paged lists and only needed data, at 3,000 ships and 10,000,000 messages: p95 under 100 ms, p99 under 500 ms, errors under 1%. Compact statements alone do not bound a whole fleet list.

## Questions for the owner

### A. What should ordinary discovery show about an offer?

1. Summary only, with its source/version (or commission note/none), beside existing identity, status and verified facts.
2. Also every capability's name and description.
3. Keep full statements; ask crews to publish less.

**Pick 1:** enough to select a candidate; response size no longer follows capability count or schema size. A summary may miss a specific capability, so the caller can inspect a candidate's full statement. Option 2 still grows with capabilities; option 3 loses callable schemas.

### B. How should a ship obtain calling detail?

1. A separate ship call for one target's full current statement, under `messages:send` and current send reach.
2. A target selector on `discover` that returns full detail for that target.
3. Use `fleet.ship`, requiring `fleet:read` and read reach.

**Pick 1:** one need per call and a clear discover, inspect, send flow. Recheck reach on inspection; an absent or unreachable target reveals nothing. Return current source/version and the complete statement, not a cached discovery copy. Option 2 mixes list and detail; option 3 changes who may learn how to send.

### C. How should the contract change reach callers?

1. Change it directly, updating protocol, guides and gateway consumers for the two-step flow.
2. Add an optional compact mode, keeping full discovery as default.
3. Introduce a parallel version of discovery.

**Pick 1:** the normal call becomes cheap for agent ships, and the gateway still obtains complete statements when needed. Options 2 and 3 retain the costly path and compatibility work that 0013 rejects. These are proposals for approval, not changes to the recorded decisions.
