# Retired ships: hidden now, removed after a retention period

Design, stage 1: the purpose for Thomas to agree, the lessons to check against, and the questions. Docs only. No detailed decisions until the purpose is agreed.

Thomas's choice, option 3 of his question: "Both: hide now, remove after a retention period". Retired ships are hidden everywhere by default now; after a retention period they are removed; their messages and events stay and show them as a retired ship.

Today a retired ship is kept for good: blueprint, Registry rules and Retire a ship; decisions 0029, 0031, 0045, 0059; retention R4 ("a retired ship's row stays for good", 0066); the `ShipRetired` and `DeliveryAbandoned` events.

## 1. Purpose (for Thomas to agree)

The fleet snapshot shows the ships that sail, and a retired ship leaves the fleet for good: hidden from every view and count at once, and after the fleet's retention period nothing of it is kept but what its kept history needs to name it.

For whom: argo and the fleet's people, who read the fleet list, counts, pickers and timelines; the fleet manager, who pays for what a fleet keeps; and the plugins (squadrons, the gateway) that retire ships as routine work (216 `ShipRetired` in the Aeolus fleet from 30 Sep to 25 Oct, retention design section 4).

The outcomes:
1. By default no view, count, picker or discovery answer shows a retired ship; one deliberate step still finds it.
2. A message or event that names a retired ship keeps showing it, by name and type and as retired, before and after removal.
3. After the retention period the retired ship's own data goes: what it was allowed, who owned it, its note, how it was commissioned.
4. Its id is never claimed or addressed again, removed or not (blueprint, Retire a ship 3).
5. Removal is visible as every change is (an event), and proven by tests as pruning is.

Not the purpose:
- Changing what retire does at the moment of retire (deliveries abandoned, lease and secret revoked, crew request removed, labels retired, owned ships falling to argo).
- Un-retiring a ship.
- What squadrons, the trierarch plugin or the gateway keep about a retired ship in their own databases (0049).

## 2. Lessons to check against

### Where a retired ship still shows today

| # | Lesson | Source |
| --- | --- | --- |
| L1 | The fleet list and ship types already answer active ships only, unless the status filter asks for retired; the console has a "Show retired (n)" switch | `common/src/rules/ship-filter.ts`, `list-fleet.ts`, `list-ship-types.ts`; blueprint, operator jobs |
| L2 | Ship counts carry a `retired` number beside active, crewed and awaiting crew | `domain/registry/ship-counts.ts`, `console/lib/ship-counts.ts` |
| L3 | `fleet.ship` answers a retired ship (its page opens from a link in a timeline or thread) | `get-ship.ts` |
| L4 | Discovery, send pickers, the reach graph and the owner picker of a network rule leave retired ships out already | blueprint, `discover`; `reach-graph.ts`; `network-rules.ts`; `selector-picker.tsx` |
| L5 | A network rules file naming a retired owner is left out with "names a ship that no longer exists" | `network-rules-file.ts` |
| L6 | A retired ship carries no labels and its own labels retire with it; owned ships fall to argo with `OwnerChanged` | 0031, 0045 |
| L7 | Timelines, threads, the inbox's senders and delivery history read senders by id, retired ones included, and show a name that may be ambiguous over time with its id | `inbox-senders.ts`, `ship-name.tsx`, `timeline-sentence.ts` |
| L8 | An undeliverable delivery to a retired ship stays stuck on Health until resent or dismissed; a resend to it is refused | blueprint, Retire a ship 2, Health 6 |
| L9 | A meeting a retired ship owned ends; it leaves meetings it took part in; its schedules are cancelled | 0061, 0062 |

### What removal touches

| # | Lesson | Source |
| --- | --- | --- |
| L10 | About 30 foreign keys name a ship, most `Restrict`: messages (sender, selector ship), deliveries (recipient, claimer), events (ship, actor, actor through), meetings (owner, moderator, opener, mic holder), participants, schedules, overdue rows, leases, credentials, console sessions, crew request give-backs, worktree clear requests, owners, label owners | `schema.prisma` |
| L11 | Messages and their events go by the fleet's retention; events that change the fleet itself (commission, retire, owners, labels, scopes, rules) are kept for good, so a retired ship stays named by kept events forever | 0066 R2, R3 |
| L12 | Ended leases and invalidated credentials already go by age past the cutoff; scope namespaces, declared network rules, verified facts, crew requests and clear requests already go at retire | 0066 R4; architecture, tables |
| L13 | The stuck snapshot reads each ship's commission and retire dates for its 168 past hours | `domain/shared/stuck.ts`; performance design, decision 9 |
| L14 | A ship's name is unique among active ships and reusable after retire; messages store the id, so a name alone cannot tell two ships apart over time | blueprint, Ship name; Registry rules |
| L15 | A commission repeated with its idempotency key answers the same ship; the key and request hash live on the ship row | architecture, `ships` |
| L16 | The fleet snapshot is one of the two promises: which ships exist, what type, who crews them | CLAUDE.md, What Aeolus is |
| L17 | Retention is configuration (installation default, per fleet, unset is kept for good), pruned once an hour in batches with `HistoryPruned`; `kept_from` says where history begins | 0066 R1, R8, R9, R10 |
| L18 | Every change writes its event; no hidden behaviour | blueprint, Principles |
| L19 | Pre-1.0: no compatibility work | 0013 |

## 3. Questions for Thomas

### Q1. What "hide everywhere by default" still changes

The fleet list, ship types, discovery, pickers and the reach graph hide retired ships already (L1, L4). What still shows them by default: the retired count (L2) and the "Show retired (n)" switch with its number.

1. **Hide what is left by default**: no retired count in the fleet's counts; the switch stays, off by default, as the one deliberate step; a retired ship's page still opens from a link.
2. **No way to list them**: the switch and the retired status filter go; a retired ship is reached only from a link in a timeline or thread.
3. **Nothing more**: hiding is done; this design is only about removal.

Pick: 1. It meets "hidden by default" and keeps the one deliberate step outcome 1 asks for; 2 takes away the only way to find a ship you know retired without its history.

### Q2. What "removed" leaves of a ship

Messages and events stay and must show the ship as retired (outcome 2), and about 30 foreign keys name it (L10).

1. **A remnant row**: the ship row stays with only its id, name, type, kind and commission and retire dates; its scopes, owner, note, commissioner and idempotency key are cleared. The foreign keys stay; nothing lists it, not even the switch; a link opens a page saying it is a removed retired ship, with its kept history.
2. **Delete the row**: the foreign keys to ships go, and every row that names a ship copies its name and type, so reads still show it.
3. **Delete the row once nothing names it**: wait until retention pruned every message, delivery and event naming it.

Pick: 1. It keeps names, types and the stuck snapshot's dates (L13) with no copy, keeps the id from ever being claimed (outcome 4), and the remnant is a few bytes. 2 copies a name into every message, delivery and event (a second source of truth). 3 never happens: kept-for-good events (commission, retire) name it forever (L11).

### Q3. Which retention period

1. **The fleet's retention** (0066): a ship retired before the cutoff is removed by the hourly pass, counted in `HistoryPruned`; unset means kept for good, as all history.
2. **A separate retired-ship retention** setting beside it.
3. **A fixed period in core**, the same in every fleet.

Pick: 1. One number the fleet manager already sets and pays by, one pass and one event already built (L17); 2 adds a setting nobody asked for; 3 is a limit core sets itself, against 0016.

### Q4. An idempotent commission repeated after removal

The key and request hash live on the ship row (L15). Clearing them (Q2, 1) means a commission repeated with the same key after removal commissions a new ship.

1. **Clear them**: a retry weeks after the retire is a new request.
2. **Keep them on the remnant**: the retry answers the removed ship, as it answers a retired one today.

Pick: 2. A key is small, and an idempotent call must never answer two ships for one key; a retry answering a retired ship is the behaviour today.

### Q5. What a link to a removed ship shows

1. **Its remnant page**: name, type, kind, retired and removed dates, and the kept history that names it (its timeline within the retention, the fleet changes for good).
2. **Not found**: the page says the ship is no longer kept; timelines and threads still name it but link nowhere.

Pick: 1. A timeline entry that opens nothing is a dead end; the remnant and its timeline query exist already.

## 4. Next

Once Thomas agrees the purpose and answers Q1 to Q5: stage 2 with the decisions in detail, the flows (happy and unhappy, as the pruning pass's), the decision record (a new one or a change to 0066 R4), and the slices.
