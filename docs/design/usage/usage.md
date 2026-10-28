# Usage over time: tokens across the fleet and its setup

Design stage 1 for usage history, with [#1309](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1309) as a related need. Docs only: purpose, lessons and questions, nothing decided in detail before the purpose is agreed. No mockup yet.

## 1. Purpose (to agree)

In Thomas's words: "I want token usage across my fleet and setup in time."

So: one place that shows how many tokens the fleet's ships used, over time, broken down by the setup that used them: the machine (the computer a trierarch runs on), the harness, the ship, the model, and the login (the subscription or an API key). Beside it, how full each harness's subscription windows were over time.

For whom: whoever answers for what the fleet's sessions use, first Thomas as the fleet's operator.

A good outcome:
1. A question such as "which machine, harness or model used most tokens last week" is answered by looking, without opening ships or report details.
2. Usage stays after a ship is released or retired, so a period can be added up later (#1309: cost per acceptance criterion per release).
3. Nothing changes for a fleet without the trierarch plugin: no trierarch, no usage read.

Not the purpose: the bill (the vendors' consoles stay the bill); limits, budgets or alerts on usage (running out is #1284 and #1286); usage of sessions a trierarch does not crew (a hand-crewed session reads no tokens); placement by usage.

The rejected first direction (a latest-reading mockup on the machine card and the ship page) is gone from this PR; its screenshots of today stay in section 5.

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Each trierarch reports `usage` in its report details: per harness its subscription windows (`windowMinutes`, `usedPercent`, `resetsAt`, `readAt`), and per ship it crews the tokens per model (input, output, cache read, cache write) with `estimatedCostUsd` at its price table, null for a model it does not price. | `packages/common/src/trierarch/report-details.ts` `harnessUsageSchema`; aeolus-fleet-trierarch `docs/trierarch.md`, "What a trierarch reports"; #353 |
| L2 | A ship's tokens are read from the harness's transcripts every 5 minutes, and count since the ship's folder was made on that machine: a running total that starts again from zero on another machine or a fresh folder. | aeolus-fleet-trierarch `docs/timings-and-limits.md` `TOKENS_READ_INTERVAL_MS`; `docs/trierarch.md` |
| L3 | Subscription windows are read when the trierarch starts and again only after 30 minutes with work since. Claude Code's costs a print-mode turn of its own; Codex's comes from its newest session log. A harness that cannot say is left out. | aeolus-fleet-trierarch `docs/timings-and-limits.md` `SUBSCRIPTION_READ_INTERVAL_MS` |
| L4 | The report holds only the latest reading. Details are status, not storage: at most 16 KB, kept on the lease, and `ShipReported` carries the details version, never the details. So core keeps no usage history today, and nothing can be plotted over time. | [0028](../../decisions/0028-report-details.md) |
| L5 | A ship leaves the report when it is released, so its usage is gone from the fleet (#1309). Tokens used after the last 5 minute read and before release are never reported. | #1309; `docs/trierarch.md` |
| L6 | The report names no login per ship yet: subscription or API key comes with trierarch draft PR #35 (Q4 pick 2 adds it beside `estimatedCostUsd`). A subscription reading names no account either, so two machines on one login report the same windows twice. | ThomasHendrickx/aeolus-fleet-trierarch#35 |
| L7 | On a subscription, `estimatedCostUsd` is what the tokens would cost at list prices, not what is paid. The price table changes with the trierarch's version and its configuration's `prices`. | `docs/trierarch.md`; #353 |
| L8 | Core's promises are the fleet snapshot and guaranteed communication; usage is neither. Aeolus distributes, it does not execute. | CLAUDE.md, "What Aeolus is" |
| L9 | The trierarch plugin is optional, a ship of each fleet it serves, reading every trierarch's report to place. Its own database holds per fleet only its connection, switch and enabled models; model governance amended 0030 to store there. | [0030](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/decisions/0030-trierarch-plugin.md); [model governance](../model-governance/model-governance.md) L3 |
| L10 | Retention is per fleet: an installation default in days, each fleet following it or its own days or none, unset kept for good; core's hourly pass prunes core's tables. A database outside core is not pruned by it. | [0066](../../decisions/0066-retention.md); [retention design](../retention/retention.md) |
| L11 | Every table has fleet_id, every query is scoped by it, every call is authorised by scopes and reach read from the server. | CLAUDE.md; [0057](../../decisions/0057-actors.md) |
| L12 | Before 1.0.0: minimal designs, no backfill or compatibility work for zero customers. | [0013](../../decisions/0013-breaking-changes-before-1-0.md) |
| L13 | #1309 asks for usage attributable to the release, issue or PR a ship worked on. The fleet knows a ship's crew request (harness, workspace, first prompt), not which release or issue it serves. | #1309; [0029](../../decisions/0029-crew-request.md) |

## 3. Where the history could live

The reading exists once, in each trierarch's report. Three places could keep it as history:

| Place | How | Costs |
| --- | --- | --- |
| A. Core | A usage table in core, written from the trierarch's report or by a usage call of its own. | Core reads meaning into details (against 0028) or gains a procedure for something outside its two promises (L8). Pruned by 0066 for free. Exists without the trierarch plugin, where nothing writes it. |
| B. The trierarch plugin | The plugin already reads every report; it turns each ship's running total into the tokens used since its last reading (a total lower than before means a fresh folder: start from it) and keeps them in its database. The console reads it through the plugin, as model governance does. | Amends 0030 again (L9). The plugin prunes its own rows, following the fleet's retention from `fleet.limits`. A missed report loses nothing, since totals are running; only the tail before release (L5) is lost. |
| C. The trierarch | Each machine keeps its own history on disk and the console asks each machine. | A machine that is off or gone takes its history with it; a fleet view needs every machine to answer. Cheapest to write, worst at the one thing asked: across the fleet. |

Size at fleet scale, for B, one row per ship, machine, model and hour with work, about 250 bytes with its index: 40 ships at work, 2 models each, 24 hours is about 1,900 rows, 0.5 MB a day, 170 MB a year. Subscription windows add per machine and harness at most 48 readings a day: 10 machines with 2 harnesses, 1,000 rows, under 0.2 MB a day. Per 5 minutes it is 12 times that (2 GB a year); per day, 24 times less.

## 4. Questions

1. **Who sees it?** Context: the Trierarchs page and report details are read with `fleet:read` today.
   1. Everyone who reads the fleet (`fleet:read`), as the Trierarchs page.
   2. Fleet managers only (`fleet:manage`).
   3. Each person their own machines' usage, fleet managers all of it.

   Pick: 1. It is the same data the report details show today, only kept; a narrower rule is a new scope for no asked need.

2. **Where does the history live?** Context: section 3.
   1. Core.
   2. The trierarch plugin, amending 0030.
   3. Each trierarch on its machine.

   Pick: 2. The plugin already reads every report and is the part that exists exactly when usage does; core stays to its promises; machines can be off.

3. **What is kept?** Context: L1, L6, L7.
   1. Tokens per ship, machine, harness, model and login, plus each harness's subscription windows per machine.
   2. As 1, and the estimated cost as the trierarch reported it at the time.
   3. Tokens only; cost worked out when read, at today's prices.

   Pick: 2. Tokens are the measure Thomas named; the estimate as it was then does not change when a price table does, and #1309 needs cost. The login is kept from the day the report carries it (#35); before that it reads "not reported".

4. **How fine-grained?** Context: section 3 sizes.
   1. Per 5 minutes, as read.
   2. Per hour.
   3. Per day.

   Pick: 2. An hour shows a working day's shape and adds up to days, weeks and releases; 5 minutes costs twelve times the rows for a curve nobody reads at that scale.

5. **How far back?** Context: L10.
   1. The fleet's retention (0066): the same days, kept for good when unset.
   2. A retention of its own for usage, in days.
   3. A fixed span, such as 90 days.

   Pick: 1. One setting, already priced per fleet (#1080); usage is finished history like a delivered message. Amends 0066's list of what goes.

6. **Which breakdowns?** Context: Thomas named fleet and setup; L6.
   1. One chart of tokens over time for the whole fleet, split by one of: machine, harness, model, ship, login; a filter per breakdown.
   2. A fixed chart per breakdown, side by side.
   3. Fleet total only, breakdowns later.

   Pick: 1. One chart and a "split by" answers every "which" question without five charts to read; a filter (one machine, one model) narrows it. Subscription windows get a chart of their own per machine and harness: they are percent, not tokens.

7. **Tokens or dollars first?** Context: L7.
   1. Tokens, with the estimated cost beside them.
   2. Estimated cost, with tokens beside it.
   3. A switch between the two.

   Pick: 3, opening on tokens. Thomas asked for tokens; #1309 asks for cost; on a subscription the dollars are list prices, which the page says once.

8. **Where in the console?** Context: the fleet overview counts what needs the operator now; usage is not that.
   1. A Usage page of its own in the navigation, shown only with the trierarch plugin; the ship page and machine page link to it filtered to them.
   2. A section on the Trierarchs page.
   3. Parts on the ship and machine pages only.

   Pick: 1. Usage across the fleet is its own question, not a machine's or a ship's; the links keep it one click from both.

9. **The tail before release.** Context: L5.
   1. The trierarch reads a ship's tokens once more when it releases it, before removing its folder, and reports them.
   2. Accept losing up to 5 minutes per released ship.

   Pick: 1. A small trierarch change, and a period's total (#1309) is then whole.

10. **Attribution to a release (#1309).** Context: L13.
    1. Not in this design: hourly history per ship already lets a release be added up between its start and its tag; tying a ship to an issue or PR is a design of its own.
    2. In this design: a crew request or ship carries what it works on, and usage is kept by it.

    Pick: 1. Time and ship answer "cost per release" today; what a ship works on is a new fact for the fleet and deserves its own purpose.

11. **Usage from before it ships.** Context: L12; transcripts outside the worktrees may still be on the machines.
    1. History starts when this ships; nothing is read back.
    2. Each trierarch reads back what its transcripts still hold.

    Pick: 1. Backfill is work for a baseline (0.32.0, #1309) that the next release's own history gives anyway.

## 5. Today

What the console shows of usage now: nothing outside report details, and only the latest reading.

The Trierarchs page and its machine card:

![Trierarchs page today](page-before.png)

![Machine card today](card-before.png)

A ship's page, its Crew request card:

![Ship page today](ship-before.png)
