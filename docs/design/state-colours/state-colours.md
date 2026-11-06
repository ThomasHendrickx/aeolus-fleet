# One meaning per colour for a ship's state

Design. Docs only. [Issue 1618](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1618); Thomas answered its five questions on 3 Nov (section 3).

Every place a ship's state shows: console ship list, ship page, Needs crew, Harbour cards and list, Bridge's Your fleet.

## 1. Purpose (Thomas, 3 Nov)

> "yeah I think fro me that is the strange part since also in console yellow = waiting for crew. So we are mixing singals here in one colour. A design system (ui package) will need to have a clear propose for what each colour means. A yellow ship is always the same, as is a red ship as are other colours"

A ship's colour means one thing, the same in every app: a reader who learned it once in the console reads it the same in Harbour and Bridge. Each meaning and its colour is written down once, as tokens in `@aeolus-fleet/ui`, with the rule beside them. Colour is never the only sign: an icon and a word say the same.

Not the purpose: what a ship's state is (the blueprint and `harbourStateOf` decide that; Harbour only splits Waiting in two), and what the tones of things that are not ships (deliveries, schedules, squadron members, machines) mean: they take the new colours with the tokens, and their meanings get their own issue.

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

## 3. Decisions (Thomas, 3 Nov)

### Five states

A ship shows one of five states, first match wins: **Alert** (an open alert), **Awaiting crew** (no session holds the lease), **Blocked** (a blocked report), **Working** (a working report), **Idle** (anything else). Harbour's Waiting splits into Awaiting crew and Blocked: two actions, two states (crew the ship; unblock the crew that is there). Harbour's numbers become six: Ships, then the five. The State filter offers the five. A ship's status (Crewed, Retired) still shows beside it in the console list and on its page.

### One meaning per colour

The five `--tone-*` families stay, each with one meaning; one family is added. Idle carries no tone.

| Token | Colour | Means | Ship state |
| --- | --- | --- | --- |
| `--tone-attention-*` | Coral | Something is wrong: act now | Alert |
| `--tone-waiting-*` | Amber | Waits on a person | Awaiting crew |
| `--tone-blocked-*` (new) | Violet | The crew says it cannot go on | Blocked |
| `--tone-active-*` | Sea | Live and in motion | Working |
| `--tone-ok-*` | Green, as today | Settled and well | Crewed |
| `--tone-ended-*` | Grey, as today | Over for good | Retired |
| none | `--muted-foreground` | Nothing going on | Idle |

### The brand's colours

The tones take the brand's meaning colours (`ui/src/brand.css`): attention from Coral, waiting from Amber, active from Sea. Text and icons use a darker shade in light and a lighter one in dark, as `--brand-coral-text` does; the hue itself shows only where nothing is read (the live band on a working tile).

| Token | Light fg / bg / border | Dark fg / bg / border |
| --- | --- | --- |
| attention | `#AE3820` / `#FFEEE9` / `#FFC2B2` | `#FFA58F` / `#3A1E19` / `#7B3628` |
| waiting | `#8A5300` / `#FDF4E1` / `#F0D198` | `#F3C46C` / `#33280F` / `#6E5119` |
| blocked | `#6B3FB8` / `#F3EEFC` / `#D3C3F2` | `#C9B1F7` / `#2A2142` / `#523E86` |
| active | `#0B6A88` / `#E8F6FB` / `#A6DAEB` | `#85D3EC` / `#0E2C37` / `#1F5E72` |

ok and ended keep today's values. Contrast, measured in the sheet (WCAG 2): every fg, text and icon alike, is at least 5.5 : 1 on its own fill, on a card and on the page in light, and at least 7.3 : 1 in dark; Idle's `--muted-foreground` is 5.8 : 1 and 7.3 : 1.

The colours live only in `@aeolus-fleet/ui`: its tone tokens carry the values, and every app takes them from the package and keeps no colour of its own. A re-colour is one change there; no app does colour work. Every tone use, ships or not, shifts with it.

### Without colour

One icon and one word per state, from one part in `@aeolus-fleet/ui` that every place uses (console list, ship page, Harbour, Bridge): Alert TriangleAlert, Awaiting crew CircleDashed, Blocked OctagonPause, Working Activity, Idle CirclePause; the status beside it Crewed UserCheck, Retired Archive. Harbour's Hourglass, CirclePlay and CircleAlert go. Needs crew is a crew request's state, not a ship's: its rows keep Needs crew (Clock, amber).

### Order

1. The rule, the new values and `--tone-blocked-*` in `@aeolus-fleet/ui` and `conventions.md`.
2. The one state part in `@aeolus-fleet/ui`, after PR 1614 lands.
3. Harbour on it with five states, and the console's list and ship page.
4. Bridge on the released part.

Other places that break the rule (C1 and C4 outside ships) get their own issue.
