# Affordable ship discovery

`discover` lists reachable ships with identity, status, verified facts and a summary only. A crew summary carries `by: crew` and its current version; otherwise the commission note carries `by: commission`, or the statement is null. Capability count and schema size do not enlarge discovery.

To inspect a chosen ship, call `ship.lookup` with exactly one name or id and `includeStatement: true`. The header remains available without that option. The requested `statement` holds the complete current crew statement with source and version, else the commission note or null. Both calls require `messages:send` and current send reach. Missing or unreachable targets answer null and reveal nothing. Reads record nothing and grant no later send permission.

```text
discover summaries -> lookup one full current statement -> send
```

Statements stay lease-bound, versioned and limited to 256 KB. The contract changes directly before 1.0, without compatibility modes. See [0047](../../decisions/0047-discovery-and-statements.md), the [ship contract](../../guide/ship-contract.md) and [compatibility](../../compatibility.md) for consumers.
