# Candidate-local declared permissions

## Purpose and approval boundary

Propose a permission-plan structure that keeps declared rules in Postgres and evaluates only declarations relevant to each candidate. Preserve the [approved behavior, contracts, cursor, snapshot and proof requirements](README.md). This proposal replaces only the declared-rule load-and-compile boundary in that design's Permission plan section. Built-ins and the fleet's own rules remain domain compiled.

Preparing this document is authorized by `approval-2026-11-10-person-read-structural-design-preparation`. Full structural approval from Thomas is pending. Neither a prototype nor a production-code change is authorized by preparation approval. The implementation in [PR #1747](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1747) remains blocked; this document makes no performance acceptance claim.

## Lessons and constraints

- [The measured checkpoint](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1747#issuecomment-6774098799) identifies declaration transfer, validation, compilation and rendering as substantial dense-policy costs, including for empty results. Fixed-subject pruning alone cannot remove distinct `from: []` rules: every subject matches their source selector.
- [0037](../../decisions/0037-declared-network-rules.md) and `declareNetworkRules` require every declared term to name a label owned by its declarer. Exact values inherit their label's owner. Declared owner terms are refused. Empty selectors remain legal, including an empty pair that grants the verb universally. Ownership-based selection must cover those grants separately.
- [0034](../../decisions/0034-network-rules.md) is the permission meaning; `allowsReach`, `selectedOf`, `owningShipOf` and `readReachOf` are the parity references. The SQL adapter translates a domain program, rather than choosing new authorization behavior.
- Keep authoritative JSON in the existing declaration tables. Add no permission cache, parallel policy store, persisted permission result or new recipient collection. Current writes continue to validate declarations and ownership in the domain.
- Preserve existing reads. This structure applies only to the three new core reads. No gateway/app implementation belongs in this proposal.
- The required budgets remain p95 below 100 ms, p99 below 500 ms and errors below 1%, at the approved scale. A bounded core prototype cannot substitute for the later integrated app/gateway/core proof with 10,000,000 retained messages.

## Proposed domain and adapter boundary

The registry domain owns an immutable permission program per fixed subject and verb. Its constructor receives current authenticated subject facts and applied settings. Its components are:

| Component | Domain responsibility | Adapter responsibility |
| --- | --- | --- |
| Built-ins and fleet rules | Compile the existing bounded candidate plan, including open, self, owner, kind and viewer branches; prune fixed terms and substitute same-value terms | Render the existing parameterized predicate |
| Declared-rule program | Select `read` or `send`; carry the subject's selected labels/owner and the term semantics below; enable declarations only when they can add rights | Select relevant authoritative declaration rows in this snapshot, interpret their terms using the program's fixed operations |
| Page/report request | Validate fleet, actor, scope, search, position and resource-id bounds | Apply the whole permission predicate before search/order/limit or report enrichment |

The facts port returns applied settings, authenticated reader facts and the stored associated ship's current scopes/labels/crew eligibility. It stops returning fleet-wide declared JSON. The permission program contains no SQL, JSONPath, driver type, database callback, recipient ids or arbitrary expression string. The projection port accepts this typed program with its fleet scope. In-memory adapters evaluate the same program over fixture declarations; they do not embed a second authorization policy.

The SQL renderer owns a closed mapping from these domain term operations to fixed SQL. Declaration JSON remains data, never generated SQL syntax. SQL shape and parameter count depend on the bounded fleet rules and fixed subject facts, not the number of fleet declarers. Accessed declaration data is interpreted according to the existing validated schema; shape/decoding failures fail the read rather than returning a successful empty result or widening access. This proposal does not change declaration validation or add a read-time repair path.

The final predicate is the OR of the bounded domain-compiled branch and the declared branch. A domain-compiled universal grant makes declaration work unnecessary for that verb. A false send-eligibility gate makes all exclusion work unnecessary. Keep the current send and read programs separate, even when they share selected facts.

## Declaration selection and completeness

For candidate `c` and fixed subject `a`, obtain label definers through fleet-scoped joins from carried label ids to `labels`. Use `owner_kind` and `owner_ship_id`, not a nullable ship id alone, to distinguish installation ownership. Deduplicate ship definers before probing their declarations.

| Rule shape | Declaration source | Evaluation |
| --- | --- | --- |
| Nonempty `to`, any `from` | Ship definers of labels carried by `c` | Inspect only this verb's rules with nonempty `to`; evaluate both selectors |
| Empty `to`, nonempty `from` | Ship definers of labels selected for `a` | Inspect only this verb's rules with empty `to` and nonempty `from`; evaluate both selectors |
| Empty `from` and empty `to` | Fleet-scoped universal existence probe | A matching verb grants every candidate |
| Installation declaration, any shape | The fleet's one installation declaration row | Evaluate its at most 20 rules by the same term operations |

Completeness follows from the declaration ownership invariant. A matching nonempty `to` requires at least one carried candidate label owned by the declarer, whether the term is exact, any or same. A matching nonempty `from` similarly requires a selected subject label owned by the declarer. Thus the first two paths cannot omit a matching non-universal ship declaration. Empty pairs have no such owner witness and require the third path. Installation rules are always covered separately, including `group` rules and universal grants. Duplicates across owner witnesses do not change allow-only OR semantics.

The candidate path reads at most 20 ship definers, each with at most 20 rules, because a ship carries at most 20 values. An account's selected groups come from its verified token, resolved against this fleet's `group` label; they are not taken from its person ship and acquire no new 20-group limit. Subject-only declaration selection is computed once per subject/verb inside the statement, deduplicated by definer. For a ship it has at most 20 definers; installation-owned groups use the separate installation row. No candidate ids leave SQL for this selection.

Valid from-only rules reduce to a fixed-subject boolean and can be evaluated once per subject/verb. They cannot contain `#`: current validation requires its counterpart on the other side. For rules with both sides nonempty, a from-side `#` still requires a matching candidate value and cannot be pre-evaluated merely because the subject carries that label. Test that invalid one-sided `#` remains refused by declaration validation. No new rule form is admitted.

## Selector operations and nullable facts

For each rule, AND every term in `from`, AND every term in `to`, then AND the two selectors. OR matching rules. An empty selector is true. Let `A(L)` and `C(L)` be the subject/candidate carried value sets for label `L`; missing labels give empty sets.

| Term | In `from` | In `to` |
| --- | --- | --- |
| Exact label value `v` | `v` belongs to subject selected values | `v` belongs to candidate carried values |
| Label `L`, `*` | `A(L)` is nonempty | `C(L)` is nonempty |
| Label `L`, `#` | `A(L)` intersects `C(L)` | The same intersection test |
| Exact owner `o` | Subject selected owner equals `o` | Candidate owner equals `o` |
| Owner `*` | Subject selected owner is non-null | Candidate owner is non-null |
| Owner `#` | Both selected owners are non-null and equal | The same equality test |

Owner operations belong to built-ins and fleet rules only; declared rules cannot contain them. For a ship, selected owner is its stored owner, while the ownership built-in uses the ship's own id. For an account, both use its resolved person-ship id. Installation has no selected owner, carried labels or owning ship. Preserve these distinct operations. A ship reading itself is the existing self-read branch, independent of its owner. Unknown exact ids match nothing.

Multiple values on one label use set intersection, not equality of arrays or one chosen value. Every term is checked independently, including mixed exact/any/same terms, different labels and conjunctions on both sides. No rule matches merely because one term's definer was selected. Subject-owner and candidate-owner nulls never compare as equal. Every rendered predicate is a total boolean; context exclusion remains `NOT COALESCE(SENDABLE(c), false)`.

Account owner facts retain a fleet-scoped stored retired/remnant association as `selectedOf` does. An unknown or cross-fleet association resolves to no owner facts. Send exclusion separately requires an active associated ship with current `messages:send`; an ended crew alone does not remove that set. The cursor binds the raw verified association id, including when it no longer resolves to an active ship. This structure changes neither association resolution nor cursor invalidation.

## SQL and index shape

The renderer produces one statement-local declared predicate per subject/verb. Conceptually:

```text
permission(candidate) = bounded_domain_plan(candidate)
  OR universal_ship_declaration_for_verb
  OR matches(installation_rules_for_verb, subject, candidate)
  OR matches(subject_definers_from_only_rules, subject, candidate)
  OR EXISTS candidate_label_definer_declaration
       with matching verb, nonempty to, and both selectors matching
```

Resolve subject definer rows and the installation row once in statement-local CTEs. They remain in the database; materializing those bounded inputs is different from materializing all declarations or all recipient ids. For each candidate, a correlated lateral/EXISTS path reads `ship_labels` by `(fleet_id, ship_id, label_id, value_id)`, joins labels by `(fleet_id, id)`, deduplicates definer ship ids, then probes `declared_network_rules` by its `(fleet_id, ship_id)` primary key. Expand at most that row's 20 rules, filter verb and shape, and evaluate selector terms with indexed candidate label probes. No per-candidate application round trip or SQL function that queries the fleet is introduced.

Keep simple label probes correlated with `OFFSET 0` as in the approved plan. The prototype must check the definer/declaration lateral paths too: an optimizer rewrite into a fleet-wide hash or JSON expansion is unacceptable even if its small fixture timing passes. Search and continuation keep their existing blank/short/trigram shapes; permissions precede `LIMIT 21`. Refresh and arbitrary-id reports start from at most 20 primary-key probes. Context enriches only its selected 20 authorized row objects, in the same snapshot, without re-evaluating the declared program.

Universal ship rules require an index independent of carried labels. Propose two partial B-tree indexes on `declared_network_rules(fleet_id)`, one per read/send verb, whose fixed predicate is `jsonb_path_exists(rules, '<literal predicate>')`. The literal tests a single rule with the verb and **both selector lengths zero**, for example:

```sql
jsonb_path_exists(rules,
  '$[*] ? (@.verb == "read" && @.from.size() == 0 && @.to.size() == 0)')
```

Use that exact fixed expression for the corresponding fleet-scoped `EXISTS ... LIMIT 1` probe, allowing the partial index to prove absence as well as presence without scanning declaration JSON across the fleet. Choose between two fixed SQL templates from the typed verb; no interpolated caller expression. JSON containment with `from: []` and `to: []` is insufficient: array containment does not prove emptiness. Indexes derive directly from authoritative JSON and update transactionally on declaration replacement/withdrawal; they are not a permission cache. The installation row needs only its existing fleet key.

Reuse the approved page/search, label, lease, alert and activity indexes, including the checkpoint's fleet-leading composite trigram indexes. No extra labels-by-owner index is needed for candidate selection: follow candidate/subject carried label ids to their definers, rather than enumerating every label a definer owns. Exact rule values are tested by fleet-scoped carried value ids; label ownership is established by the validated declaration invariant, not by loading the label-value catalogue for every rule.

## Snapshot, current rights and failures

```mermaid
sequenceDiagram
    participant API as Existing authentication adapter
    participant Domain as Registry read use case
    participant UOW as Read unit of work
    participant DB as Postgres
    API->>Domain: Verified actor, fleet, bounded input
    Domain->>UOW: Begin read
    UOW->>DB: Shared network-settings lock, before snapshot
    UOW->>DB: Begin repeatable-read read-only transaction
    Domain->>DB: Load settings and current fixed-subject facts
    Domain->>Domain: Check scope/crew and cursor; construct typed programs
    Domain->>DB: Page or bounded batch with candidate-local declaration predicates
    DB-->>Domain: At most 21 authorized narrow rows or bounded reports
    Domain->>Domain: Keep 20 rows and last returned key
    opt Nonempty context page
        Domain->>DB: Enrich selected authorized rows only
        DB-->>Domain: Reports in the same snapshot
    end
    UOW->>DB: Finish transaction, unlock, return connection
    Domain-->>API: Existing response contract
```

All facts, universal probes, declaration rows, candidate labels, statements and selected reports use the same checked-out connection and repeatable-read snapshot. Acquiring the existing shared settings lock before snapshot creation preserves serialization with rule writers. Scope, label, ownership, retirement and statement changes obey the existing writers' transaction/lock rules. No new lock spans calls. A later page obtains a new snapshot with current rights, using the existing query-bound continuation key without an anchor lookup or settings-version binding.

| Path | Required result |
| --- | --- |
| Valid actor and matching rights | Existing authorized page/batch and cursor behavior |
| No declaration can match | Bounded false declared branch; built-ins/fleet rules still apply |
| Missing scope, ended discovery crew or invalid cursor | Existing refusal before projection, never successful empty data |
| Missing/retired/unreadable arbitrary report id | Indistinguishable unavailable result, with no hidden metadata enrichment |
| Rule withdrawal or label/owner/scope change between pages | Next snapshot rechecks current facts; no stale permission result |
| SQL failure, timeout, cancellation, decoding failure or broken connection | Fail call; roll back, unlock and reset or discard connection through existing unit-of-work cleanup |

Old reads keep their existing on-behalf support; the new fleet reads continue to authorize the actual actor and refuse on-behalf input. A report service failure remains a failure at core. Gateway partial-state handling remains in the approved contract, outside this slice.

## Migration prerequisites

Only after structural approval, add a separate additive migration for the two universal indexes. Do not edit an applied migration or persist a new policy representation. Test creation on populated authoritative JSON, replacement/withdrawal/retirement maintenance, exact partial predicates, and Prisma migration diff behavior. Record index size, build time and write overhead in the prototype evidence. Startup migration locking and rollout remain the existing release process; the builder has no production access.

Use PostgreSQL 16 in Testcontainers, matching the known deployment major. The earlier search migration requires `pg_trgm` and `btree_gin`; the new B-tree partial indexes need no further extension. Extension availability and the actual deployment migration role's database CREATE privilege or preinstalled extensions must be confirmed by the deployment owner before rollout. Local proof cannot confirm deployment grants. Missing prerequisites fail migration rather than silently selecting an unindexed path.

## Approval questions and proof plan

The structural approval requested is the typed domain program plus SQL interpretation of authoritative candidate-local declarations, the three complete ship-declaration selection paths, separate installation handling, and the two universal indexes. The preferred choice is this structure because it addresses context and standalone reports together. Report-only bounded loading cannot resolve context; fixed-subject pruning alone cannot resolve distinct empty-from dense rules. No product behavior question is intentionally changed by this proposal. Any parity ambiguity goes to the orchestrator with a proposed choice before implementation.

After Thomas approves the full structure, the proposed bounded prototype proceeds one approved scenario at a time, red, green, refactor:

1. Prove the domain program against the existing permission model with in-memory ports. Cover open/closed, each built-in positive and negative branch, viewer switch, self, owner versus owning ship, all actor kinds and group resolution. Keep the old reads' regression tests unchanged.
2. Prove actual PostgreSQL parity against `allowsReach`/`readReachOf` over the cross-product of exact, any and same terms on each side, empty/nonempty selectors, conjunctions, multiple values, missing/unknown values, null/exact/any/same owners and mixed fleet-rule terms. Declared owner terms and one-sided `#` remain validation refusals. Include ship and installation declarations, irrelevant verbs, from-only grants, empty pairs by a declarer with no carried label witness, duplicate definer witnesses and no matching declaration. Compare sets before paging, not just the first visible row.
3. Prove current-rights and snapshot behavior under concurrent rule replacement/withdrawal, label/owner/scope/statement changes and declarer retirement. Re-run raw unit-of-work cancellation, rollback, lock-before-snapshot, broken connection and pool lifecycle scenarios. Prove raw cursor-association binding separately from active send eligibility.
4. Repeat the checkpoint's 42 sparse/dense operation shapes on fresh Testcontainers databases with the same 3,000-ship, other-fleet and retained-history fixture. Retain 60,000 distinct empty-from conjunctions; add maximum carried-label/definer fanout, longer conjunctions, universal present/absent, from-only, same-value, installation/group and broad/sparse rights cases. Measure discovery, context, standalone 20-id reports and refresh, including no-match and deep/common searches. Record new-pool and warm-pool samples separately, p95/p99/error rate, transfer bytes, query count, fact/compiler/renderer/query phases and total core-call latency. Repeat an over-budget run; do not rename a phase improvement as end-to-end acceptance.
5. Capture `EXPLAIN (ANALYZE, BUFFERS)` for the actual executed fact/projection SQL, including universal presence/absence and maximum-fanout paths. Verify fleet-leading indexes, per-candidate declaration probes, bounded expansion, no global declaration/label/history scan, no multi-MB policy round trip, no full recipient-id materialization and no look-ahead report work. An empty or 20-id result must not trigger whole-fleet policy transfer. SQL call count stays independent of returned rows.

### Required combined failed-witness workload

Step 4 must also measure the following combined workload, rather than proving fanout, conjunction length and sparse rights separately. The checkpoint's 60,000-rule fixture carries only the first pair on each target; it does not prove this path. This is required bounded prototype evidence after Thomas approves the full structure, not a prediction or claim of passing performance.

Construct 3,000 active candidate ships, each carrying exactly 20 values, one from each of 20 distinct ship declarers. Each declarer owns its own labels and values and declares exactly 20 relevant rules. Reuse these declarers across candidates: this gives 400 potentially relevant rules per candidate without inventing a higher declaration limit. Retain the other-fleet and history ballast from step 4. Keep declarers active and use ordinary candidate kinds and unrelated owners, a non-argo subject, closed fleet rules that do not grant these candidates, no meeting/reply context, no installation grant, no universal declaration and no from-only declaration. Assert that built-ins do not bypass the candidate declaration path.

Use existing validation, not direct invalid JSON: `invalidRule` in `network-settings.ts` limits each selector to `SHIP_LABELS_MAX` (20) distinct terms and requires a counterpart for `#`; `declareNetworkRules` additionally checks label ownership and the 20-rule limit. A label has at most 50 values and a ship carries at most 20 values (0031). All referenced values must exist and every declared term must belong to its declarer. Two valid variants are required:

- Maximum conjunction missing witnesses: for each declarer define 20 labels, one value on each, and give every candidate only the first label's value from that declarer. Each rule has a 20-term `to` selector: that carried exact value and the 19 other owned exact values, with their order rotated between rules. Use a 20-term `from` selector of owned `*` terms on those labels. This is valid even when a source cannot satisfy all terms. Include an empty-`from`, nonempty-`to` variant to prevent source pruning from hiding the candidate-side missing witnesses. Each candidate still selects every declarer, but no declaration grants it. Record which selector/term work the actual plan eliminates or executes.
- Late failure and corresponding late match: per declarer use one label with values `v0`, `v1` and `w1` through `w20` (22 values, within 50). Initially every candidate carries `v0`. Use empty `from`; rule `i` has `to: [{labelId, value: '*'}, wi]`. The first term holds and the last exact term fails in all 20 rules. In the matching variant replace the last rule's last term by `v1`, and give only 1 or 20 candidates `v1` in place of `v0` for the last declarer in the fixture's definer order. Every candidate still carries exactly one value from every declarer; the remaining candidates still exhaust all rules. Require a broad late-match run with all candidates carrying that `v1` too. SQL evaluation order is not guaranteed: actual rows/loops must show whether the intended late witness was reached; fixture insertion order alone is no proof.

Maximum 20-term conjunctions and late failure are not interchangeable: with 20 distinct definers and only 20 carried values, a candidate has only one value per definer. It cannot satisfy 19 distinct owned terms before failing term 20. Do not pad selectors with duplicate terms or cross-declarer terms to manufacture that case. The maximum-length missing-witness variant and the valid late-failure/match variant together establish the legal combined stress paths, with maximum fanout retained in both.

Run discovery with blank and common name searches covering all 3,000 candidates, with zero and fewer than 21 authorized results, so `LIMIT 21` cannot stop the failed-witness scan early. For context keep the associated person ship active with `messages:send` and independently evaluate the account read and person send predicates. Split each declarer's 20-rule budget into 10 read and 10 send rules, rather than allocating 20 per verb. Include zero read matches, sparse late read matches with failed send witnesses, and broad late read matches with broad late send matches yielding zero context rows; prove both predicates execute in the latter cases. Run standalone reports for 20 distinct candidate ids with failed, sparse late-match and matching read rights. Discovery/report single-verb runs may use all 20 rules for that verb. Assert expected authorized sets against the parity reference before measuring.

For every variant and operation capture actual executed `EXPLAIN (ANALYZE, BUFFERS)` for facts, permissions, projection and selected report enrichment, including actual rows, loops, rows removed and buffers for candidate, definer, rule and term nodes. Show the absent universal/from-only paths and both context predicates; report any planner short circuit rather than assuming 400 rules or a term order was executed. Measure complete core-call new-pool and warm p95/p99/error rates with step 4's phase and query evidence, including connection, lock, snapshot, facts, construction, SQL, enrichment and cleanup. Keep p95 below 100 ms, p99 below 500 ms and errors below 1%; a SQL-only timing or fewer transported bytes cannot establish acceptance. Repeat over-budget runs and return failures to the orchestrator. No prototype or improved latency is established by this document.

The later integrated app/gateway/core staging proof remains required at 10,000,000 retained messages and the full approved workload. Neither the frozen checkpoint's green CI nor a successful bounded prototype establishes that result. Standard repository checks and the required independent review remain separate from performance acceptance.

## Risks and fallback

Candidate-local evaluation trades one large policy transfer for repeated bounded SQL work. Maximum label-definer fanout, many nonmatching conjunctions, planner rewrites or common searches may still exceed budget. Partial-index predicate matching and JSONPath semantics require actual database proof. The interpreter can drift from the domain model; exhaustive negative parity and unchanged write validation are essential. Index maintenance adds declaration-write and migration cost.

If parity, bounded plans or latency fail, stop at the measured prototype and return the failing shape and alternatives to the orchestrator. The fallback is the frozen blocked checkpoint, with existing shipped reads preserved. Do not ship a slower fallback, relax the budget, introduce a cache, weaken current rights or change populations. A further structural alternative requires Thomas's approval.
