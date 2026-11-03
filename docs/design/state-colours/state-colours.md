# One meaning per colour for a ship's state

Design, stage 1. Docs only. Purpose, lessons and questions for Thomas; no detailed decisions until he answers. [Issue 1618](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1618).

[sheet.html](sheet.html), [sheet.png](sheet.png): every ship state in every place, today and proposed (the picks below), light and dark. The HTML stands alone, with the tone tokens inlined.

## 1. Purpose (Thomas, 3 Nov)

> "yeah I think fro me that is the strange part since also in console yellow = waiting for crew. So we are mixing singals here in one colour. A design system (ui package) will need to have a clear propose for what each colour means. A yellow ship is always the same, as is a red ship as are other colours"

A ship's colour means one thing, the same in every app: a reader who learned it once in the console reads it the same in Harbour and Bridge. Each meaning and its colour is written down once, as tokens in `@aeolus-fleet/ui`, with the rule beside them. Colour is never the only sign: an icon and a word say the same.

Not the purpose: what a ship's state is (the blueprint and `harbourStateOf` decide that; question 1 only asks whether Harbour shows one more), and the tones of things that are not ships (deliveries, schedules, squadron members, machines), beyond question 5.

## 2. Lessons to check against

### Where a ship's state shows today

| # | Place | State: colour (icon) | Source |
| --- | --- | --- | --- |
| L1 | Console ship list, Status | Awaiting crew: amber (CircleDashed). Crewed: green (UserCheck). Alert: red, filled (TriangleAlert). Retired: grey (Archive) | `console/components/molecules/status-badge.tsx:80-82, :120` |
| L2 | Console ship list, Report; ship page report line | Working: blue (Activity). Blocked: amber (OctagonPause). Idle: grey (CirclePause) | `console/lib/report.ts:14`, `report-line.tsx:19-23` |
| L3 | Ship page header | The same badge as L1, then the report line as L2 | `features/ship/ui/organisms/ship-header.tsx:273` |
| L4 | Needs crew page | Needs crew: amber (Clock); with the trierarch plugin, the crew request's states (Crewing blue, Running green, Restarting amber, Crashed red) | `needs-crew-list.tsx:75, :91`, `status-badge.tsx:100-106` |
| L5 | Sidebar, Needs crew count | Neutral grey pill, while its rows are amber; the Health count beside it is red | `components/organisms/sidebar.tsx:89, :108` |
| L6 | Harbour (console build) numbers and tiles | Alert: red, filled (CircleAlert). Waiting: amber (Hourglass). Working: green (CirclePlay). Idle: grey word, plain tile | `features/fleet/ui/molecules/harbour-state.ts:11-15` |
| L7 | Harbour in `@aeolus-fleet/ui` ([PR 1614](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1614), open) and [fleet-overview](../fleet-overview/README.md) mockups | As L6; the Idle number turns plain | `ui/src/molecules/harbour-tile.tsx`, `harbour-numbers.tsx` in PR 1614 |
| L8 | Bridge, Your fleet (aeolus-fleet-gateway, branch `bridge-your-fleet`) | As L6; the Idle number in foreground | `web/features/bridge/fleet/ui/fleet-wall.tsx:9-14`, `fleet-numbers.tsx:7-12` |

### The rules today

| # | Lesson | Source |
| --- | --- | --- |
| L9 | Harbour's state, first match: an open alert is Alert; awaiting crew or a blocked report is Waiting; a working report is Working; anything else is Idle. Bridge has the same rule in its own code | `core/src/domain/registry/harbour.ts:29-37`; gateway `src/core/people/your-fleet.ts:45-63` |
| L10 | Five tone families (waiting, active, ok, attention, ended), each fg, bg and border, light and dark, already in `@aeolus-fleet/ui` | `ui/src/tokens.css:23-37, :138-152` |
| L11 | The mapping: Blocked and Awaiting crew are waiting; Working is active (blue); Idle and Retired are ended. Harbour and Bridge break it: Working is green there | `docs/design/conventions.md:15`; `fleet-overview/README.md` |
| L12 | Status is never colour alone: icon and word always | `conventions.md:16` |
| L13 | The brand gives three colours a meaning, never decoration: Sea "live and active", Coral "alerts only", Amber "waiting on a person". No part uses them; the tones are other hues (active `#1653A1`, not Sea `#2BA3C9`) | `ui/src/brand.css:15-19`, `brand.stories.tsx:60-86` |
| L14 | Retired ships show in no count and in the list only on request; a retired ship's page still shows its grey badge | [decision 0070](../../decisions/0070-retired-ships.md) |
| L15 | The blueprint names a ship's status (awaiting crew, crewed, retired) and its report (working, blocked, idle); it gives neither a colour | `docs/blueprint.md:239, :146` |

### Where one colour means two things

| # | Colour | Meanings |
| --- | --- | --- |
| C1 | Amber | Awaiting crew (no session holds the lease) and Blocked (the crew says it cannot go on), merged into one Harbour state, Waiting. Also, outside ships: pending, forming, restarting, paused, late, seen long ago |
| C2 | Green | Crewed in the console list; Working in Harbour and Bridge. One ship, crewed and working, is green in Harbour and green plus blue in the list below it |
| C3 | Grey | Idle (crewed, nothing to do) and Retired (gone for good) |
| C4 | Blue | Working in the console; also handed, crewing, releasing, standing down (in motion) |

And one meaning with several looks: Working (green in Harbour, blue in the list), Idle (grey, plain or foreground by place), Needs crew (grey count, amber rows), Alert (TriangleAlert in the console, CircleAlert in Harbour), Waiting for crew (four words, four icons).

## 3. Questions

Each with options and my pick. The sheet's Proposed column draws the picks.

**Q1. Which states does Harbour show for a ship?**
1. Keep four: Alert, Waiting, Working, Idle. Waiting stays both; only its icon could tell them apart.
2. Split Waiting into five: Alert, Awaiting crew, Blocked, Working, Idle, first match in that order. The console's Status and Report columns show the same words.
3. Split, and Blocked joins Alert: four states, red for both.

Pick 2. Awaiting crew asks the operator to crew the ship; Blocked asks someone to unblock a crew that is there. Two actions, two states. Awaiting crew before Blocked: a ship without crew cannot be unblocked.

**Q2. One colour per meaning: which, and their tokens in `@aeolus-fleet/ui`?**
1. Keep the five `--tone-*` families and write one meaning for each beside the tokens and in `conventions.md`; add `--tone-blocked` (violet) for the one meaning that has none. Red `attention`: something is wrong, act now (Alert). Amber `waiting`: waits on a person (Awaiting crew, Needs crew). Violet `blocked`: the crew says it cannot go on. Blue `active`: in motion (Working). Green `ok`: settled and well (Crewed). Grey `ended`: over for good (Retired). Idle carries no tone.
2. As 1, with per-state tokens on top (`--state-working-fg` pointing at `--tone-active-fg`), so a state can change colour in one place.
3. As 1, but Blocked shares amber with Awaiting crew ("waits on a person"), told apart by icon and word only.

Pick 1. One layer, the names already exist, and each name is the meaning. Idle plain, as the Harbour mockup already draws it, so colour marks only what is going on; Retired keeps grey.

**Q3. Do the tones take the brand's meaning colours?**
1. Yes: `active` from Sea, `attention` from Coral, `waiting` from Amber, each made readable as text (as `--brand-coral-text` is).
2. No: the tones keep their hues; the brand's meanings are written to match them (Sea is `active`, Coral is `attention`, Amber is `waiting`).

Pick 2. The meanings already agree (L13); the hues differ but read as the same family. Changing every tone is a wider change than this issue.

**Q4. How does a state show without colour?**
1. One icon and one word per state, held in one `@aeolus-fleet/ui` part every place uses (console list, ship page, Harbour, Bridge): Alert TriangleAlert, Awaiting crew CircleDashed, Blocked OctagonPause, Working Activity, Idle CirclePause, Crewed UserCheck, Retired Archive.
2. Keep each place's own icons (Hourglass and CirclePlay in Harbour); only the colours line up.

Pick 1. The console's icons are the older and wider set; CirclePlay already means a running session on Needs crew.

**Q5. In what order, and how far?**
1. (a) The rule and `--tone-blocked` in `@aeolus-fleet/ui` and `conventions.md`. (b) The one state part in `@aeolus-fleet/ui`, after PR 1614 lands. (c) Harbour on it, five states, and the console's list, ship page and Needs crew count. (d) Bridge on the released part. Other tone uses that break the rule (C1, C4 outside ships) go in their own issue.
2. Harbour first (split Waiting, Working blue), the rule after.
3. All at once, every tone use included.

Pick 1. The rule comes before what follows it; ships first, as Thomas named ships.
