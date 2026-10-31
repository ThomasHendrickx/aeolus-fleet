# UI package mockups

Screens for [issue 1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206), on the structure in [`../README.md`](../README.md). Thomas, 31 Oct: "UI design I expect screens and an some options on what it will become, what it will look like later on".

Each HTML file stands alone: the tokens from `packages/common/src/header/tokens.css` and the Geist fonts are inlined. Each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [today.html](today.html), [today.png](today.png) | Buttons, inputs, switches, tabs, toasts, status badges, empty states and the scope picker as the console, the gateway and pagasae draw them now, side by side, each with its source path and where it drifts |
| [after.html](after.html), [after.png](after.png) | Those parts once, as `@aeolus-fleet/ui` would draw them on today's tokens, light and dark; then a screen of each app built only from them (console fleet overview, gateway outside parties, pagasae account rights), desktop and phone, light and dark |
| [option-1.html](option-1.html), [option-1.png](option-1.png) | Option 1, Compact: the parts and the same three screens, light and dark, desktop and phone |
| [option-2.html](option-2.html), [option-2.png](option-2.png) | Option 2, Soft: the same |
| [option-3.html](option-3.html), [option-3.png](option-3.png) | Option 3, Crisp: the same |
| [compare.html](compare.html), [compare.png](compare.png) | Today's tokens and the three options on one console screen and one phone screen, side by side |

## After the package

Where the apps differ today, the console's part wins: it is the one drawn from the design system. Two parts change in substance:
- **StatusBadge** carries every app's states (Approved, Sign-in failed, On, At limit) with tone, icon and word; the gateway's two icon-less pills and pagasae's ToneBadge go.
- **ScopePicker** shows each scope's meaning first and its code beside it, grouped by who declares it, with a search field when the list is long; picked scopes stay chips that keep their meaning. It replaces the commission dialog's scope switches, the gateway's code-only chips (#1205) and pagasae's right rows. The descriptions come as props from each app's server (UP3).

## Where the look goes later

Each option changes only tokens and a few part knobs, so it is one change in `@aeolus-fleet/ui` for every app. All three keep what is not taste: icon and word on every status, 44 px touch targets, text contrast 4.5:1, one primary per view.

| | Option 1, Compact | Option 2, Soft | Option 3, Crisp |
| --- | --- | --- | --- |
| Density (desktop) | Controls 32 px, rows 40, body 13 | Controls 40 px, rows 56, body 15 | As today: 36, 48, 14 |
| Corners | Controls 6 px, cards 8 | Controls 12 px, cards 16 | Controls 3 px, cards 4 |
| Colour | As today, slate blue | A brighter blue, cards on a shadow without a border | Ink primary (near black, near white in dark), firmer borders |
| StatusBadge | Icon and word in the tone, no fill; Attention keeps its fill | Filled pill, no border | Neutral tag, a tone bar on the left, word in the text colour |
| Phone | Unchanged sizes; smaller corners, quiet badges | Rounder, roomier cards | Square corners, ink buttons |

**My pick: option 1, Compact.**
- The apps are lists: ships, parties, rights, requests. Compact puts more rows on a screen without dropping a column.
- Quiet badges leave colour to what needs a look. A column of green fills reads as noise; with option 1 the one filled red badge stands out. Icon and word still carry every state.
- It is the smallest step from today: no new colour, the brand blue from the app mark and sign-in backgrounds stays, and phones keep their touch sizes.
- Cost: 13 px body is the floor for long reading, so prose blocks (charters, payloads, docs pages) stay at 14 px.

Option 2 suits the Account app's people who are not operators, but a fleet of 40 ships no longer fits one screen, and its brighter blue competes with the active tone. Option 3 reads precise, but it drops the slate blue the brand carries, and tag badges are hard to scan in a long column.
