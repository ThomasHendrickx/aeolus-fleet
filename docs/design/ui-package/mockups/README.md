# UI package mockups

Screens for [issue 1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206), on the structure in [`../README.md`](../README.md).

Each HTML file stands alone: the tokens from `packages/common/src/header/tokens.css` and the Geist fonts are inlined. Each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [today.html](today.html), [today.png](today.png) | Buttons, inputs, switches, tabs, toasts, status badges, empty states and the scope picker as the console, the gateway and pagasae draw them now, side by side, each with its source path and where it drifts |
| [after.html](after.html), [after.png](after.png) | Those parts once, as `@aeolus-fleet/ui` would draw them on today's tokens, light and dark; then a screen of each app built only from them (console fleet overview, gateway outside parties, pagasae account rights), desktop and phone, light and dark |
| [compact.html](compact.html), [compact.png](compact.png) | The same parts and screens in the chosen look, Compact |

## After the package

Where the apps differ today, the console's part wins: it is the one drawn from the design system. Two parts change in substance:
- **StatusBadge** carries every app's states (Approved, Sign-in failed, On, At limit) with tone, icon and word; the gateway's two icon-less pills and pagasae's ToneBadge go.
- **ScopePicker** shows each scope's meaning first and its code beside it, grouped by who declares it, with a search field when the list is long; picked scopes stay chips that keep their meaning. It replaces the commission dialog's scope switches, the gateway's code-only chips (#1205) and pagasae's right rows. The descriptions come as props from each app's server (UP3).

## The look: Compact

Thomas, 31 Oct: "ui -> compact (option 1)". Not built yet: `tokens.css` and the parts still draw today's look.

| | Today | Compact |
| --- | --- | --- |
| Desktop density | Controls 36 px, rows 48, body 14, page padding 32 by 24 | Controls 32 px (sm 28, xs 24), rows 40 (header 32), body 13, page padding 24 by 20 |
| Corners | Controls 8 px, cards 10, badges 6 | Controls 6 px, cards 8, badges 4 |
| Cards | Border and a small shadow | Border, no shadow |
| StatusBadge | Filled in its tone, with border | Icon and word in the tone, no fill or border; Attention keeps its fill |
| Colour, type family | Slate blue, Geist | Unchanged |
| Phone | Touch sizes 44 px | Unchanged; corners and badges as on desktop |

Unchanged rules: icon and word on every status, text contrast 4.5:1, one primary per view. Long prose (payloads, charters, docs pages) stays at 14 px.
