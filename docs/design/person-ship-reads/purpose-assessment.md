# Fleet page purpose assessment

A docs-only look at why the Fleet page needs the person ship reads, before more backend design goes in. It decides nothing: the options and questions are for Thomas.

Sources, pinned: app design [app-060 Fleet](https://github.com/ThomasHendrickx/aeolus-app/blob/65b9e8ca70328f9f533eb66538f9d5eda4c2b804/docs/design/app-060/README.md) (purpose, answers, approved design), [app #97](https://github.com/ThomasHendrickx/aeolus-app/issues/97), [fleet #1741](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1741), [person ship reads](README.md), [rule matches](rule-matches.md), PR #1747 and the [lock order addendum](https://github.com/ThomasHendrickx/aeolus-fleet/blob/4e58297c83720c907b5c881b6aa07e462b21633b/docs/design/person-ship-reads/rule-matches-lock-order.md).

## The jobs

Thomas's ask in #97: what does a business user need to know about the ships they can reach? Be outcome focused, with no vanity metrics. The approved purpose (F1 option 1) splits into three jobs:

| Job | Question it answers | What serves it |
| --- | --- | --- |
| J1 Find who can help | "Who can help me with this?" | Ships the person ship can send to now, with a human description and a Message action |
| J2 See what a ship reports | "What do they say is happening?" | The crew's state, note and last activity. The app design itself says this is evidence of activity, not progress |
| J3 See context | "What else is out there that I can read?" | Ships within read reach that the person cannot message, marked context only (F2 option 1) |

Only J1 leads to an action. J2 and J3 are browsing: useful perhaps, but optional to finding who can help. The page's other promise, "where do I go to move this forward", is already served by Home (what waits on the person) and Conversations, which the design keeps reachable when the directory fails.

## Evidence and assumptions

Evidence:

- Thomas approved F1 option 1, F2 option 1 and the detailed design (10 Nov). That makes it the approved experience, but no user research or usage data is cited for it.
- UX assessment #73, finding 15: the old page opened with six mostly-zero totals that described access rather than outcomes. This is evidence against the old page, not for a directory of a particular shape.
- Today the gateway's `list-ships` returns the whole core discovery as the person ship (send reach, no paging). A contactable list without paging or search therefore already exists as a read.
- The cost record. PR #1747 measured the dense shape: discovery p95 was 19.5-76.9 ms, under the 100 ms budget. Context was 275.9-396.5 ms and reports 297.6-328.1 ms, both over. The candidate-local attempt then failed: sparse blank p95 was 2,378 ms, and the combined workload timed out at 5 s on two fresh databases. The rule matches prototype touches 51 core files (+2,365/-471). Keeping its matches consistent needs the network settings lock taken first on about 40 use cases. That lock order is approved by nobody, and its contention gates are unmeasured.
- One observed fleet size: this implementer ship's discovery in the live fleet returned 17 ships on 11 Nov. That is one ship's send reach in one fleet, not a person's, so it shows nothing about real person fleets.

Assumptions (not backed by any source found):

- That a person often cannot find whom to ask, so that a search over descriptions pays for itself.
- That 3,000 ships and 10,000,000 retained messages are near-term fleet sizes. The app design states this as a design target, and no observed fleet is cited.
- That J2 and J3 help a business user decide anything.

Most of the cost sits in two requirements together: send reach enforced in the database for paging and search at 3,000 ships, and the context section's exclusion of the full sendable set. J1 alone, in the shape PR #1747 measured, already met the budget.

## Options

Every option keeps today's rights. None adds a permission, a routing rule or a new kind of ship.

| Option | Person gains | Person loses | Build cost | Ongoing consistency cost |
| --- | --- | --- | --- | --- |
| A. Full overview as approved: both sections, search, reports, 3k gates | J1, J2 and J3 at any target size | Nothing against the design | Highest. Two approaches have not met the gates, and the third needs an unapproved change to about 40 paths, still unmeasured | Every future writer of labels, owners or rules must keep the matches. The lock order binds every new use case |
| B. Contactable directory: J1 only, names, descriptions and Message, no reports or context | The actionable job | Status and context browsing (F2's context section, J2) | Lowest new work. A paged and searchable J1 met the budget in PR #1747's dense shape. Other shapes at 3k are unmeasured | None new, if it is built on discovery-time evaluation rather than kept matches |
| B+. B plus a report batch for the loaded 20 | J1 and J2 | Context browsing | B plus the report read, which measured 297.6-328.1 ms p95 in PR #1747. That is over budget, the fix is not designed, and the cost is smaller than context | Low |
| C. One known entry point: the person messages one ship the operator names as the place to ask, and its crew forwards | A single obvious first step | Choice. The person does not see or pick the ship that helps, and every request adds a hop | No core reads. The operator crews and keeps that ship. The person ship needs send reach to it, which the operator declares as today. Aeolus has no routing feature; the forwarding is that crew's own business (blueprint: distribution, not execution). It must never be argo (blueprint, 0053) | None in core. Answer quality depends on that one crew |
| D. No overview: Home, Conversations and links people share | Nothing new | Finding a helper they have not talked to before | None in core. Whether the app can open a conversation from a shared link is not checked here | None |
| E. Defer: hold #1741 and gateway #343, and keep #97's page without the directory until a real fleet shows the need | Nothing now | J1 to J3 until then | None now. The prototype evidence stays reusable | None |
| F. Abandon: close #1741 and #343, and rescope #97 | Clarity | J1 to J3 | Discards PR #1747 and the rule matches prototype | None |

## Recommendation

Choose B, with E for J2 and J3. Build the contactable directory first, the one job that leads to an action. Defer reports and the context section until someone shows a person needs them. Stop the rule matches prototype and PR #1747's context read rather than tuning them. Their evidence stays frozen and reusable.

Two things this needs, both Thomas's call, not this note's:

- F2's answer (context after messageable) is set aside for now.
- The 3,000-ship gate for J1 is measured in all of #1741's shapes before acceptance, or tied to a real fleet size. If sparse shapes fail it, B falls back to discovery-time evaluation, and kept matches return only with a fleet that needs them.

## Questions for Thomas

1. Is J1 (find who can help) the job for the first Fleet release, with reports and read-only context deferred? Or are J2 and J3 needed now? If so, what evidence says a business user needs them?
2. Are 3,000 ships and 10,000,000 messages a size a person's fleet will reach soon, or a ceiling? What size are people's fleets today?
3. Is there evidence that people cannot find whom to ask today? If not, would D or C (one known entry point) do for now?
4. May the sunk work be discarded: PR #1747's context and report reads, the candidate-local proposal (PR #1750) and the rule matches prototype? Or should they stay frozen as evidence?
