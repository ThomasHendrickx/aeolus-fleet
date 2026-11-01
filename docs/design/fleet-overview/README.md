# Fleet overview: Harbour

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
- **Order:** the listing order (argo first, then by name), so a page reads through `ships_listing_idx` by keyset; the browser groups the tiles and orders each group by state, then name.
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
