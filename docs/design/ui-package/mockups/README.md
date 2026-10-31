# UI package mockups

Screens for [issue 1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206), on the structure in [`../README.md`](../README.md).

Each HTML file stands alone: the tokens from `packages/ui/src/tokens.css` and the Geist fonts are inlined. Each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [today.html](today.html), [today.png](today.png) | Buttons, inputs, switches, tabs, toasts, status badges, empty states and the scope picker as the console, the gateway and pagasae draw them now, side by side, each with its source path and where it drifts |
| [after.html](after.html), [after.png](after.png) | Those parts once, as `@aeolus-fleet/ui` would draw them on today's tokens, light and dark; then a screen of each app built only from them (console fleet overview, gateway outside parties, pagasae account rights), desktop and phone, light and dark |
| [compact.html](compact.html), [compact.png](compact.png) | The same parts and screens in the chosen look, Compact |

## Which app's part the package takes

Thomas, 31 Oct: "Scope picker of gateway, the rest can be console".
- **ScopePicker:** the gateway's (`features/outside-party/tools-table/ui/scope-picker.tsx`), a multi-select Combobox: picked scopes are chips with their code, the list searches by code or description and shows both. Each scope's description comes as props from the app's server (UP3). It replaces the commission dialog's scope switches and pagasae's right rows.
- **Every other part:** the console's. StatusBadge also carries the gateway's and pagasae's states (Approved, Sign-in failed, On, At limit) with tone, icon and word; the gateway's two icon-less pills and pagasae's ToneBadge go.

## The look: Compact

Thomas, 31 Oct: "ui -> compact (option 1)". Built in its own slice, U4 ([README](../README.md), section 7): until then `tokens.css` and the parts draw today's look.

| | Today | Compact |
| --- | --- | --- |
| Desktop density | Controls 36 px, rows 48, body 14, page padding 32 by 24 | Controls 32 px (sm 28, xs 24), rows 40 (header 32), body 13, page padding 24 by 20 |
| Corners | Controls 8 px, cards 10, badges 6 | Controls 6 px, cards 8, badges 4 |
| Cards | Border and a small shadow | Border, no shadow |
| StatusBadge | Filled in its tone, with border | Icon and word in the tone, no fill or border; Attention keeps its fill |
| Colour, type family | Slate blue, Geist | Unchanged |
| Phone | Touch sizes 44 px | Unchanged; corners and badges as on desktop |

Unchanged rules: icon and word on every status, text contrast 4.5:1, one primary per view. Long prose (payloads, charters, docs pages) stays at 14 px.
