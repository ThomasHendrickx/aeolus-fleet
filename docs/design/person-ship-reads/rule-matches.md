# Rule matches kept at write time

Status: structural proposal for [#1741](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1741), awaiting Thomas's decision. It authorizes no prototype, implementation or performance experiment. The [approved design](README.md) stays the source for behaviour, contracts, cursor, snapshot, search, reports and proof. This proposal would replace only its Permission plan section, and only for the three new reads.

## Purpose

Let the three person ship reads (`ship.discoveryPage`, `fleet.readableContextShips`, `fleet.shipReports`) check current send and read rights for every candidate before paging. The work per candidate must stay bounded by a small constant for every valid fleet policy, so complete calls meet p95 under 100 ms, p99 under 500 ms and errors under 1% at 3,000 active ships. That includes the policies that defeated both earlier structures. Permission meaning, current rights on every page and send, fleet isolation, authorized substring search, exclusion of the full sendable set before paging, actor-bound cursors and one snapshot per call all stay as approved.

## Lessons to check against

### What was measured

Every number below was measured on a local shared host in Testcontainers with PostgreSQL 16 and 3,000 seeded active ships plus history ballast. These are bounded core-call results, not production estimates.

| Structure | Shape | Warm p95 ms | Warm p99 ms | Errors | Source |
| --- | --- | ---: | ---: | --- | --- |
| Frozen checkpoint, whole-policy compile | dense discovery, every search shape | 19.5 to 76.9 | up to 83.5 | 0 | [#1747 checkpoint](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1747#issuecomment-6774098799) |
| Same | dense readable context, every shape | 275.9 to 396.5 | up to 401.4 | 0 | same |
| Same | dense 20-id reports | 297.6 to 328.1 | up to 329.5 | 0 | same |
| Same | sparse common-trigram discovery / context | 61.7 to 66.8 / 75.5 to 77.0 | up to 72.1 / 77.5 | 0 | same |
| Candidate-local JSON interpretation | sparse blank discovery | 2,378.28 | 2,668.59 | 0/31 | [failed evidence](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0cac9088860dc0bf3624e6a5fe9c9e4c22d68f78/artifacts/1741/990872691e3eb1a7873035a2188dcec39c93014b/README.md) |
| Same | sparse one-character discovery | 146.98 | 157.44 | 0/31 | same |
| Same | combined 20-definer, 20-term missing-witness blank discovery | none | none | 1/1 in each of 2 fresh databases, 5 s statement timeout | same |

Measured phase split for the checkpoint's dense context, blank search, p95: facts 145.9 ms, compiler 59.4 ms, renderer 47.1 ms, query 79.5 ms. For dense reports: facts 126.7 ms, compiler 48.4 ms, report renderer 52.4 ms, report query 75.0 ms. The prototype's sparse blank page query phase alone was 2,371.7 ms p95. A replay of its captured SQL with literal values ran in 120.2 ms outside the timed call, with the declaration subplans showing zero loops.

### Why both structures failed

These are diagnoses from the evidence and code above. Where a cause is not measured, it says hypothesis.

1. **The checkpoint's read work grows with the whole fleet policy, not with the page.** It loads every declaration in the fleet, validates it, compiles it and sends it back as a parameter, then evaluates it in SQL. All four phases were measured to grow with 60,000 declared rules even for empty or 20-id results. Pruning on the fixed subject cannot remove rules with an empty `from`: they hold for every subject. 3,000 declarers with 20 rules each is a valid fleet (0037), so this structure has no bound at the legal maximum.
2. **The candidate-local prototype's read work grows with candidates × relevant rules × terms, and each term is interpreted JSON.** For each candidate, correlated subplans expand the declarer's `rules` JSON, then each selector, then each term through `jsonb_typeof` cases. When fewer than 21 rows are authorized, `LIMIT 21` cannot stop the scan, so every one of the 3,000 active candidates is evaluated. The legal maximum is 20 definers × 20 rules per candidate (a ship carries at most 20 values, 0031, and each declarer holds at most 20 rules, 0037), each with up to 40 terms. The combined fixture timed out. This was measured. The exact executed row counts are not known, because no EXPLAIN completed.
3. **The prototype's bound depended on planner choices the tests could not see.** The live call took 2,371.7 ms and the literal replay 120.2 ms. Both were measured. The cause of the gap is a hypothesis: bound parameters stopped the planner from short-circuiting the built-in branches before the declaration subplans ran. Either way, a bound that depends on constant folding or on the order subplans run in is not a structural bound.
4. **Common root (hypothesis, from counting):** both structures test rule selectors against candidates at read time. Any read-time evaluator then has a valid workload of about 3,000 candidates × 400 relevant rules, around 1.2 million candidate-rule tests, whenever results are sparse. That includes a relational version with normalized term tables and a count join, which I counted but did not run. At typical executor cost per row, that is far over 100 ms. Only work done when a rule or label changes can take this out of the read.
5. **An unmeasured gap with the same root:** the fleet's own rules (up to 200, 0037) are compiled per subject in both structures. 200 rules with an empty `from` and a 20-term `to` that fails late give 3,000 × 200 candidate tests on a sparse blank page. Neither run measured this.

### Facts the structure relies on

- 0037 and `declareNetworkRules`: every term of a ship's or the installation's declared rule is on a label that declarer owns. Declared owner terms are refused. An empty `from` or `to` is legal, and so is an empty pair, which grants the verb to every candidate.
- `invalidRule`: at most 20 terms per selector, each once. A term of the same value (`#`), on a label or on the owner, must appear on both sides.
- `holds` in `network-settings.ts`: an exact value holds when the ship carries it, label `*` when it carries some value of the label, label `#` when both sides share a value of the label. Owner `*` holds for a non-null owner, owner `#` for two equal non-null owners, an exact owner for equality. A rule holds when every `from` term holds for the sender and every `to` term for the recipient.
- `rulesInForceOf`: with no own rules applied (open), declarations are not consulted at all.
- 0031: a ship carries at most 20 values, and a carried value or label is never removed or deleted. Labels retire with their owner and go with a retired ship. 0052: the installation declares a default send rule `group=#` to `group=#`, so terms of the same value are the common case, not an edge case.
- 0034: one advisory lock per fleet. Sends and reads hold it shared; `declareNetworkRules` and retirement take the settings for update. `assignLabel` and `unassignLabel` lock only the ship row today, and retirement locks the ship row before the settings.

## Questions for Thomas

**Q1 (structure, unavoidable): may core keep derived rule matches, maintained in the same transaction as every change they derive from, for the new reads?** Read-time evaluation has no bound at the legal maximum (lesson 4), so a bounded read needs work done at write time. The earlier designs said "no permission cache, parallel policy store or persisted permission result". Rule matches are not a cache: they are never stale and have no staleness rule. They are not a permission result for any pair of ships either, and they are not a policy store, since declarations stay authoritative in their own tables. They are new persisted derived data, though, kept in step by application writers rather than by Postgres as an index is. That is the decision.

| Option | What it means | Bound | Cost |
| --- | --- | --- | --- |
| **A. Rule matches (recommended)** | Per ship, per verb, per rule source: which rules' `to` selector the ship meets, kept on every write that changes them | One index range of at most 22 rows and at most one label probe per candidate, whatever the policy | Writers named below maintain them under one lock order. A declaration or own-rules change rewrites up to 3,000 ships' rows. |
| B. Limit policy size | A new product limit, such as total declared rules per fleet, so read-time evaluation fits | Bound only as tight as the new limit | Changes 0037. Plugins and groups could hit refusals they do not hit today. |
| C. Narrow the required workloads | Accept the checkpoint and leave adversarial policies out of the budget | None at the legal maximum | Contradicts "all required valid workloads". Listed only to reject it. |
| D. Store reach per pair of ships | Who may send to or read whom, as rows | Constant per candidate | Up to 9 million rows per verb, and one label change rewrites up to 3,000 rows. Rejected. |
| E. Postgres triggers computing matches | Same as A, maintained in SQL | Same as A | Brings back a SQL interpreter of selectors, which can drift from `holds`. Rejected. |

**Q2 (structure): what write cost may the writers pay?** With A, declaring or replacing rules, and applying the fleet's own rules, rewrite the matches of every ship carrying an affected label: up to 3,000. This happens while holding the settings for update, so sends in that fleet wait meanwhile. Recommendation: hold those writes to the same p95 under 100 ms and p99 under 500 ms at 3,000 carriers, measure them in the prototype, and come back to you if they fail. The alternative is a separate, looser bound for these rare administrative writes.

**Q3 (structure): how are populated fleets filled?** A SQL migration can only create the empty tables, because computing matches needs the domain's term meaning. Recommendation: after migrating, core builds each fleet's matches once, idempotently, under that fleet's settings lock held for update, and marks the fleet built. Until then the new reads fail as a service error, never as an empty or partial page. Alternatives: a SQL backfill, which needs a SQL interpreter (rejected as in E), or building lazily on first read, which a read-only transaction cannot do.

**Q4 (proposed check, yours to add or not):** add a consistency guard to every writer's Testcontainers test: after the use case commits, the stored matches equal a fresh computation from the authoritative tables. New checks come only from you; without this guard, a writer that forgets to maintain matches is a silent permission bug.

**Q5 (proposed workload):** add the fleet's own 200-rule late-failing conjunction (lesson 5) to the required proof. It is valid today and neither earlier run measured it.

No product behaviour question is open. If any of Q1 to Q3 is answered other than as recommended, this structure stops and goes back to the orchestrator.

## Proposed structure

Everything in this section is a hypothesis until a prototype approved by Thomas measures it.

### Rule sources and the split of a rule

A rule source is the fleet's own rules, the installation's declaration, or one ship declarer's declaration. A rule is named by its source and its place in that list, as `ReachRule` already does. For verb `v`, sender or reader `a` (the subject) and candidate ship `c`, the approved permission is:

```text
permission(a, c) = built-ins(a, c)            -- unchanged, compiled per call
                OR open                        -- unchanged
                OR some rule r of verb v: from_r holds for a AND to_r holds for c
```

Split each `#` term into a one-sided part and a pair part. The one-sided part of label `#` is "carries some value of the label", and of owner `#` it is "has an owner". The pair part of label `#` is "both carry one value of the label", and of owner `#` it is "both have the same owner". The one-sided part follows from the pair part, so:

```text
from_r(a) AND to_r(c)  =  from'_r(a) AND to'_r(c) AND every pair key of r is shared by a and c
```

Here `from'` and `to'` replace each `#` term by its one-sided part. They depend on one side only.

### What is stored

One derived table, `ship_rule_matches`, in the registry's Prisma adapter, with no new events (the authoritative change already writes its event):

| Column | Meaning |
| --- | --- |
| `fleet_id`, `ship_id` | The candidate, an active ship |
| `verb` | `send` or `read` (manage is not used by these reads and is not stored) |
| `source` | `fleet`, `installation` or the declarer's ship id |
| `to_rules` | Bit string: rules of this source and verb with a nonempty `to` for which `to'` holds for the ship |
| `to_rules_every_actor` | `to_rules` restricted to rules with an empty `from`: they grant every actor |

Primary key `(fleet_id, ship_id, verb, source)`, with fleet first, so a candidate's rows are one index range. A row exists only when `to_rules` is nonempty. A ship meets a declarer's nonempty `to` only by carrying one of that declarer's labels (0037), so a ship has at most one row for the fleet, one for the installation and 20 for declarers per verb: at most 22, and about 132,000 rows per 3,000-ship fleet. Rules with an empty `to` are never stored: they depend only on the subject and are handled per call.

The domain computes rows with one pure function over a ship's carried values, its owner and the rules of the sources concerned. It reuses `holds` with `#` terms read as their one-sided part, so the adapter stores bits and interprets no selectors. When the fleet is open, `rulesInForceOf` consults no rules, and the read short-circuits on open before reading matches.

Empty-pair declared rules (empty `from` and empty `to`) grant every candidate for every actor, from any declarer in the fleet. They keep the partial-index existence probe from the [candidate-local proposal](https://github.com/ThomasHendrickx/aeolus-fleet/blob/2e34e5aabbcca37b5851fe60f0e7d9ad1291f651/docs/design/person-ship-reads/candidate-local-permissions.md), which Postgres maintains from the authoritative JSON. Empty-pair own rules are seen in the loaded fleet rules.

### What a call computes for its subject

In the read's unit of work, after the shared lock and snapshot as approved, the domain loads the subject's facts (approved), the fleet's own rules (at most 200), the installation's declaration (at most 20 rules) and the declarations of the ship declarers whose labels the subject carries: at most 20, each at most 20 rules. An account carries only `group` values, which the installation owns, so ship declarations never add sources for an account. No other declaration is read. For each of these at most 22 sources it computes:

- `from_rules[source]`: the rules with a nonempty `from` for which `from'` holds for the subject.
- Collapse to every candidate if some rule in `from_rules` has an empty `to`, if an own rule is an empty pair, or if the empty-pair probe finds one. This is the approved "a matching rule with no candidate restriction collapses that verb to true".
- Pair entries: for each pair key the subject has (a label it carries, or its selected owner) and each source, the rules in `from_rules` holding a `#` term on that key. The subject carries at most 20 values, so there are at most 21 keys, and at most 41 entries across own and declared sources.

The SQL shape and parameter sizes then depend only on these bounds, never on how many rules or declarers the fleet holds.

### Per candidate

```text
granted(c) = collapse OR built-ins(c)
          OR some row m of c and verb v:
               m.to_rules_every_actor is nonempty
            OR (m.source in subject sources AND
                (m.to_rules AND from_rules[m.source]
                   AND NOT needed_by_unshared_keys(m.source, c)) is nonempty)
```

`needed_by_unshared_keys` ORs the pair entries of that source whose key `c` does not share with the subject. It reads one fleet-scoped probe of `ship_labels` primary key for `value_id = ANY(subject values on pair labels)`, at most 20 rows, plus the candidate's owner column. It is skipped when the subject has no pair entries.

Why this is exact: a rule survives only if `from'` holds for the subject (its bit is in `from_rules`), `to'` holds for the candidate (its bit is in `to_rules`) and none of its pair keys is unshared. That is the split above. A declarer whose labels the subject does not carry can grant only through rules with an empty `from`, and those are exactly `to_rules_every_actor`. Rules with an empty `to` collapsed the call already. Empty pairs were probed.

Per candidate this is at most one index range of at most 22 rows, at most one label probe of at most 20 rows, and at most 41 bit operations, whatever the policy. On a sparse blank page that is 3,000 such candidates. The adapter renders it from fixed templates as a correlated `EXISTS` on the page's existing candidate scan, so permissions still apply before cursor, search recheck, order and `LIMIT 21`, as approved. Readable context evaluates the read subject (the account) and the send subject (the associated person ship) with separate parameters on the same rows: `READABLE(c) AND NOT COALESCE(SENDABLE(c), false)`, with exclusion over the full set, as approved. Reports and row refresh probe the same rows for at most 20 ids.

Unchanged from the approved design and checkpoint: search and its indexes, the description function, cursor contents and bindings, the lock before the snapshot, report projection, failure handling, and the existing send check `checkReach`, which keeps using `allowsReach`.

### Writers and lock order

Rule matches change exactly when a ship's carried values or owner change, or a rule source's rules change. Each writer recomputes the rows concerned in its own transaction:

| Writer | Rows recomputed |
| --- | --- |
| `assignLabel`, `unassignLabel`, commissioning with labels or an owner, `setOwner` | That ship's rows for `fleet`, `installation` and the label's declarer |
| `declareNetworkRules` (ship or installation), withdrawal | Every active carrier of the declarer's labels: up to 3,000 |
| `applyNetworkRules`, import that applies | Every active ship's `fleet` rows: up to 3,000 |
| `retireShip` | Its own rows go; as a declarer, its withdrawal is the row above |
| `changeLabelValues`, `deleteLabel` | None while 0031 forbids removing carried values; the prototype must prove that guard holds |
| Built-in switches, open | None: compiled per call |

Write skew is the main correctness risk. Today `assignLabel` locks only the ship, so a concurrent declaration could compute a carrier's rows from labels the assignment is about to change, and the assignment from the old rules. Proposed lock order for every writer above: the fleet's settings advisory lock first (shared for ship-label and owner writers, for update for rule writers), then rows. Retirement currently takes the ship row before the settings, so it would move to this order. That change to an existing writer is part of Q1's approval. A read takes the shared lock before its snapshot, as approved, so it sees every writer's rows and authoritative change together or not at all.

### Migration

One additive migration creates `ship_rule_matches` and the per-fleet built marker, with no extension beyond the approved `pg_trgm` and `btree_gin`. It keeps the two universal partial indexes from the candidate-local draft. The rows are filled as Q3 decides. Deployment extension and migration-role prerequisites stay with the deployment owner, as before.

## Proof required after approval

This follows the approved design's proof and the candidate-local proposal's combined workload, red, green, refactor per scenario, with every number measured as complete core-call new-pool and warm p95/p99/error rates, query counts, phases, and actual `EXPLAIN (ANALYZE, BUFFERS)` row, loop and buffer counts:

1. **Parity:** generated fleets compare `allowsReach` with the rule-match decision for every pair of subject and candidate, in memory and in Postgres. Cover exact, `*` and `#` on labels and owner on both sides, empty selectors, empty pairs, from-only rules, multiple values on one label, accounts with groups, the installation, ships, the person ship as owner, null owners and open.
2. **Consistency:** after every writer in the table, stored rows equal a fresh computation (Q4). The concurrency matrix covers declare against assign, apply against assign, retire against assign, setOwner against apply, and reads during each. Lock order is proven deadlock-free under those pairs.
3. **Reads at the legal maximum:** the candidate-local proposal's combined workload: 20 definers × 20 rules per candidate, missing-witness and late failure and match, sparse, broad and empty results, discovery, context with both predicates, and 20-id reports. Add sparse blank and one-character searches with zero and fewer than 21 authorized rows, and a pair workload: the subject carries 20 values, and 20 declarers each hold 20 `#` rules whose pair keys are unshared. Add Q5's own-rule workload if accepted. The plan must show at most 22 match rows and at most one label probe per candidate, with no declaration JSON read per candidate.
4. **Writes at the legal maximum:** declare and replace with 3,000 carriers, apply 200 own rules over 3,000 ships, assign a label on a ship carrying 20 values, and send latency while each runs, against Q2's answer.
5. **Populated migration:** build time and size for 3,000 ships with other-fleet ballast, reads refused before the build, and rebuild idempotence.
6. **Unchanged:** the approved scenarios for cursors, current rights between pages, full-set exclusion, literal search, snapshots and lifecycle failures, and the existing reads' regression tests.

Over-budget runs are repeated once and returned with the failing shape. The integrated app, gateway and core staging proof at 3,000 active ships and 10,000,000 retained messages remains required after implementation and is not replaced by any bounded run.

## Risks

- **A forgotten writer is a silent permission bug.** Q4's guard and an inventory of every write to `ship_labels`, `ships.owner_ship_id`, declarations and own rules reduce the risk, but cannot prove a future writer correct.
- **Write cost and fleet-wide send waits** on declarations and own-rule changes (Q2). Hypothesis, unmeasured.
- **Common-trigram pages were already 61.7 to 77.0 ms p95 measured,** before the extra match probe. The probe's cost per candidate is a hypothesis.
- **Parity drift** between `holds` and the one-sided reading is contained by reusing one function, but needs the generated parity proof.
- **The new reads and `checkReach` decide by different code paths.** A divergence would show a ship that a send then refuses, or hide one that is sendable. The parity proof covers this. Moving sends onto rule matches is out of scope.
