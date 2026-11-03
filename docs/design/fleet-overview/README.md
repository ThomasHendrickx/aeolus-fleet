# Fleet overview: Harbour

Harbour as built (0.37) is below. [One view: cards or list](#one-view-cards-or-list) draws the overview as one view with a cards and list switch, and Harbour as the part the console and Bridge share.

[Issue 1441](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1441). Thomas, 31 Oct, asked for "5 alternatives to get an overview of the fleet ... more marketing friendly showing the ships and their status", then picked: "Fleet overview 5 is the most usefull. 4 is a gimmick". Built in [#1475](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1475): Harbour sits on top of the fleet overview, the three counts and the fleet table below it.

[harbour.html](harbour.html), [harbour.png](harbour.png): desktop light and dark, phone light and dark, in the Compact look ([ui-package mockups](../ui-package/mockups/README.md)). The HTML stands alone, with the tokens and Geist fonts inlined; the PNG is that file rendered in Chromium at 1x.

## What it shows

- **Numbers on top:** ships, then Alert, Waiting, Working and Idle, each with its status icon and word. Only Alert is filled in its tone.
- **One tile per ship below**, grouped by kind: People, Agents, Plugins, Through the gateway (the proxy ships the gateway crews). In each group: alerts first, then waiting, working, idle.
- **A tile** holds the ship's name and its status: icon and word in the tone, the tile filled in the tone (Alert attention, Waiting waiting, Working ok). Idle tiles stay plain, so colour marks only what is going on.
- **What a ship is doing** (its report) shows in the tile's title on hover and on tap; long names truncate.
- **Phone:** the same numbers in one row of five, tiles three across.

The mockup groups ship states into four for its numbers and tiles: Alert (an open alert), Waiting (awaiting crew or blocked), Working, Idle. Which state lands in which group is for the build to settle against the blueprint; the mockup decides no behaviour.

## The read Harbour needs

Thomas picked a tailored read over paging `fleet.list` whole ([#1475](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1475)) and approved this design with option 1 for both questions (section 4).

### 1. Purpose

Harbour needs, for every active ship the caller reads whole: its id (to open it), name, kind (its group), its state (Alert, Waiting, Working or Idle) and what it is doing (its report's note); and the five numbers. Nothing else: no labels, scopes, crew request, ping, model or location.

The state, as Thomas confirmed, first match wins: an open alert is Alert; awaiting crew or a blocked report is Waiting; a working report is Working; anything else (an idle report, or none yet) is Idle. Groups: argo and person ships are People, agent Agents, plugin Plugins, app Through the gateway; the viewer ship, retired ships and ships outside read reach are left out.

### 2. Lessons to check against

- [Performance design](../performance/performance.md), decision 3: an event reloads only the rows it concerns, never the whole list. Decision 4: every list is paged by cursor in the database query, within a maximum.
- The budget per read at 3,000 ships: p95 under 100 ms, p99 under 500 ms.
- One call per resource and need: Harbour gets its own procedure, not `fleet.list` with every field.
- The overview's guard (`e2e/overview-pages.e2e.test.ts`, "without reading every ship of the fleet") stays as it is: Harbour never asks `fleet.list` at the largest page size.
- A rule computed in SQL is held to its pure domain rule by an integration test, as `fleet.shipCounts` is to `shipCountsOf`.

### 3. The read's contract

- **Procedure:** `fleet.harbour`, query, `fleet:read`, scoped by `fleet_id` and the caller's read reach (decision 0034), as `fleet.list` is.
- **Input:** `{ cursor?, limit? }`, limit at most 500, default 500; or `{ shipIds }`, at most 100, for the live reload of single tiles.
- **Output:** `{ items: [{ id, name, kind, state, note }], nextCursor, counts }`, `counts` = `{ ships, alert, waiting, working, idle }` on the first page only (null on later pages and for `shipIds`).
- **Order:** the listing order (argo first, then by name), so a page reads through `ships_listing_idx` by keyset; the browser groups the tiles and orders each group by state, then last activity newest first, then name; a ship that never did anything comes last in its state (Thomas, #1605).
- **The statement:** active ships (`retired_at IS NULL`, every kind but viewer) in reach, `LEFT JOIN leases` on the open lease (`leases_ship_id_open_key`) for status, report state and note, and `EXISTS` an open alert (`alerts_open_on_ship_idx`); the state is one `CASE` in that order. The counts are one aggregate of the same `CASE` over the same ships, read through a partial index of the active ships, with the fleet's open alerts joined once rather than looked up per ship and per count. No new index.
- **The rule:** `harbourStateOf` in `core/src/domain/registry`, pure; the integration test holds the `CASE` to it for every combination of status, report state and alert.
- **Live:** a ship event (with `AlertRaised` and `AlertCleared` added, as in the Harbour PR) reads `fleet.harbour({ shipIds: [that ship] })` and replaces the tile in place, placing a new ship in its group; the counts query reloads, once at a time as `createLiveReloads` does. A resync reads it whole again. No interval refresh.
- **Size:** about 100 bytes a ship: about 300 KB at 3,000 ships, against about 3 MB through `fleet.list`.
- **Performance test (integration, Testcontainers):** 3,000 active and 3,000 retired ships, half crewed with reports, 300 with open alerts. Asserted on the plan, not a time: a page of 500 reads 501 to 502 rows through `ships_listing_idx` however far on it starts, each lease and alert lookup once per ship of the page, and the counts read only active ships. Staging measures the times once merged.

### 4. Questions for Thomas

**Q1. Counts: in the first page, or their own call?**
1. In the first page's answer: one round trip, read in the same transaction as the page.
2. A second procedure, `fleet.harbourCounts`: one need per call, cached apart.

Pick: 1. The numbers and the tiles are one view read at once; a separate call can disagree with the tiles it sits on.

**Q2. Does the browser still read every page?**
1. Yes, page after page, so every ship has a tile (7 calls at 3,000 ships).
2. No: the first page only, with "and N more" after it.

Pick: 1. Thomas's pick was "the whole fleet in one screen"; each call stays inside the budget and the total is a tenth of today's payload.

## One view: cards or list

Mockups for [#1605](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1605). Thomas approved them on 3 Nov with option 1 to every question below: they are the acceptance criteria.

Thomas, 3 Nov: "the fleet overview page in console now has both the new view and the old list ... And i cant filter the new card view". On Bridge he chose one view with a switch between cards and list and one filter bar for both (state, type, label, search, applying to whichever view is shown, the view kept in the address), with: "Plus the harbour needs to be shared between bridge and console, just different screen width. --> so this is something that can go to ui package".

Built on what was approved: Harbour above, the fleet table as it is today ([FleetTable](../png/FleetTable.png)), and Bridge's Your fleet (aeolus-fleet-gateway `design/bridge-fleet-width`, with the answers on aeolus-fleet-gateway#197). Each HTML file stands alone; each PNG is that file rendered in Chromium at 1x. Open the HTML to see hover, focus and the live band run.

| File | What it shows |
| --- | --- |
| [console-desktop.html](console-desktop.html), [png](console-desktop.png) | The console at 1440 × 900 and 1920 × 1080, light and dark: cards, list, and the same filters in both views, each with its address |
| [console-phone.html](console-phone.html), [png](console-phone.png) | The console at 375, light and dark: cards, list, filters in force as chips, the filter Sheet, no match |
| [console-states.html](console-states.html), [png](console-states.png) | Every interaction and state, light and dark: the filter bar (rest, search focus, hover, focus, each filter open, in force, pending), the view switch, no match in both views, argo alone, loading, the read failing, the tile's states and its times; and the shared part's props |
| [bridge-your-fleet.html](bridge-your-fleet.html), [png](bridge-your-fleet.png) | Bridge's approved frames at 1440, 1920 and 375, light and dark, with Your fleet drawn by the same Harbour part |

### What changes

- **One view.** The numbers on top count the whole fleet. Under them one bar: search, State (Alert, Waiting, Working, Idle), Type, Labels (as today: values picked show under the bar as "Ships with a and b"), Clear filters, the count ("4 of 19 ships") and the switch, Cards or List. Under the bar either Harbour's groups of tiles or the fleet table, filtered the same.
- **The address** keeps the view and the filters: `/` is cards with nothing filtered; `view=list`, `state` (repeated), `type`, `label`, `q` as the overview has them today. Switching view keeps every filter.
- **Pending.** A pick shows at once (#815); what is below dims and the count says Updating until the new result is in.
- **No match:** "No ships match these filters." or "No ships match "query"." with Clear filters or Clear search, in either view. **argo alone:** no bar, as today, and the empty state with Commission your first ship.
- **Phone:** the filters move into a bottom Sheet behind a filter button that shows how many are in force; each shows as a chip under the search. The switch keeps its icons. Tiles two a row.
- **Order inside a group:** alerts first, then waiting, working, idle; inside a state the newest last activity first, then by name, a ship that never did anything last (Thomas, #1605).
- **The tile** is Bridge's: kind icon, the whole name, what the ship is doing (two lines), its state and when it last did something ("now", "25 min", "yesterday", "2 d" up to 6 days, then "28 Oct"; "No activity yet" when it never did). Hover lifts it and shows the arrow; focus has the ring; a working tile carries the live band; reduced motion stills both. A click opens the ship's page.

### The shared part: Harbour in @aeolus-fleet/ui

Props only: no fetching, router, live wiring or filters. It lays itself out by its own width (a container query), not the window's: five large numbers and four tiles a row in the console at 1440 (seven at 1920), five small numbers and one tile a row in Bridge's column at 1440 (three at 1920), two a row on a phone.

| Part | Props |
| --- | --- |
| `Harbour` | `counts: HarbourCounts \| undefined`, `groups: readonly HarbourGroup[] \| undefined` (undefined draws the loading shape), `now: Date`, `hrefOf?: (shipId) => string` (none: tiles are not links), `between?: ReactNode` (the console's filter bar; Bridge passes none), `empty?: ReactNode` (stands in for the groups: no match, argo alone), `state: 'ready' \| 'loading' \| 'error'`, `onRetry` |
| `HarbourNumbers` | `counts: { ships, alert, waiting, working, idle } \| undefined` |
| `HarbourGroup` | `kind: 'people' \| 'agents' \| 'plugins' \| 'gateway'`, `tiles` in the order given |
| `HarbourTile` | `{ id, name, state, note, lastActivityAt }` with its group's kind, `href` and `now`; the time words are formatted inside the part, so both apps say them alike |

The tile's shape and `HarbourState` stay `@aeolus-fleet/common`'s (`rules/harbour`, `schemas/harbour`).

### Questions for Thomas

1. **The tile in the console.** (1) Bridge's tile everywhere, four a row at 1440. (2) The console keeps today's small tile (name and state, eight a row), a `density` prop on the part. Pick: 1. One part, as asked; the console gains what the ship is doing and when.
2. **Which view `/` opens.** (1) Cards, the list at `?view=list`. (2) List, cards at `?view=cards`. Pick: 1. Harbour is the overview's hero, and Bridge shows the same.
3. **Today's other filters** (crew request, kind, squadron, Show retired). (1) Gone: the bar holds the four you named; Needs crew keeps its own page. (2) Kept in the bar, for both views. (3) Kept for the list only. Pick: 1. One bar that means the same in both views; Harbour holds no retired ships.
4. **The list's Status column next to the State filter.** (1) The list stays as today (Status Crewed or Awaiting crew, Report Working, Blocked or Idle); State filters by Harbour's state. (2) The list's Status column shows Harbour's state. Pick: 1. Keeps the approved table; the switch is the only change to it.
5. **The three counts under Harbour today** (Ships crewed, Awaiting crew, Stuck). (1) Gone: Harbour's numbers are the counts; stuck deliveries live on Health. (2) Kept under the numbers. Pick: 1. Two rows of numbers is the "both the new view and the old list" this issue removes.
6. **The numbers and the filters.** (1) The numbers count the whole fleet. (2) They count what the filters show. Pick: 1. The numbers are the fleet snapshot; the bar's count says how many are shown.
7. **Bridge's numbers.** (1) Harbour's five, Ships first, in place of four with "18 ships" in the heading. (2) A prop that leaves Ships out for Bridge. Pick: 1. One part, no option for it.
