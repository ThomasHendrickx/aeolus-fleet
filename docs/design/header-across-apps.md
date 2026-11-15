# The theme and the apps across every Aeolus app

The design for [issue 1125](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1125) (carry the chosen theme across the Aeolus apps) and what is left of [issue 1036](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1036) (one Aeolus apps menu in every app), together because both live in the header every app shows ([header design](header/README.md)). Milestone core 0.40.0.

Thomas approved stage 1 (purpose, what exists, lessons, questions) on 15 Nov: the purpose as written and every pick (section 4). Stage 2, the before and after mockups, is section 5. No code.

## 1. Purpose (decided)

**The problem, for whom.** A human who moves between the Aeolus apps (Console, Gateway, Account, Admin) should feel they are in one product. Two things break that today:

- **The theme does not travel.** Thomas, testing 0.29: "I changed to dark in console; changed to gateway and is light again. Same for console to account and any other way between them. Each web app remembers its theme and that is it. (switching to argo also changes the theme depending on what it was for argo)". This hits every account that opens two apps, and every account allowed as argo that signs in as argo.
- **Only the open app can be searched.** The apps menu (the AppSwitcher in the header's title) is in every app, but ⌘K finds only the open app's own pages and actions, plus the other apps by name. A page or action in another app (a gateway party, Your rights in Account) is found only by switching app first. And the MCP address with Copy, which issue 1036 asks for, is nowhere in the header.

**The purpose.**

- **One theme per browser.** A human picks Light, Dark or System once, in any app's avatar menu, and every Aeolus app shows it from the first paint, whoever they are signed in as (their account or argo).
- **⌘K finds anything in any app.** From any app, ⌘K finds the pages and actions of every app the account may open, and opens them there (header design H4).
- **Copy MCP address from anywhere.** Where the account may open the gateway, the header offers its MCP address with Copy (H11).

**Not the purpose.**

- New rights: the header shows and links; each app still decides what its pages allow (header design, part 1).
- A shell or micro frontends (0043).
- Other preferences across apps (language, density): none exist.
- A theme that follows a human to another browser: question T1 asks it.

**What is left of issue 1036 (decided).** The cross-app palette plus Copy MCP address: this design builds both.

## 2. What exists today

At `c4f56dd27`, with the gateway and the account app as the [UI package design](ui-package/README.md) (section 2) found them.

**The theme.**

- **Console, an account.** Kept in the browser cookie `aeolus_console_theme` (`packages/console/lib/browser-theme.ts`), a year, the console's host only: the accounts design's C5 ([Accounts in the console](accounts/console.md)), since core stores nothing of an account (0058).
- **Console, argo.** Kept on argo's operator row in core (`operators.theme`, `console.setTheme`, `packages/core/src/domain/identity/set-theme.ts`), so it follows argo to any browser. Signing in as argo swaps the account's theme for argo's: the "switching to argo" in the report.
- **Console, the viewer.** No theme; it follows the system (blueprint, Account and Console rows).
- **First paint.** The console's root layout reads the theme on the server (`lib/theme-of-session.ts`) and sets it before React hydrates (`themeScript` in `lib/theme.ts`).
- **Gateway and the account app.** Each keeps its own theme cookie (issue 1125).
- **The header design's H13** kept the theme per app until this design; it now points here (section 4).
- **The avatar menu** (`packages/ui/src/molecules/avatar-menu.tsx`) shows the theme choice and hands it to the app (`onThemeChange`); each app keeps it its own way.

**The apps menu and ⌘K.**

- **The AppSwitcher** (`packages/ui/src/molecules/app-switcher.tsx`) is in the AppHeader of the console, the gateway and the account app. Its list comes from the account app's `GET /api/apps` (H1, shape `appsListSchema` in `packages/common/src/schemas/apps-list.ts`), shaped by `appSwitcherOf` (`@aeolus-fleet/common/rules`).
- **The console's CommandPalette** (`packages/console/features/commands/`) lists the console's pages and actions, then the other apps by name, from the switcher. `@aeolus-fleet/ui` also has a CommandPalette (`packages/ui/src/organisms/command-palette.tsx`).
- **The gateway and the account app have no palette**: ⌘K does nothing there.
- **No manifests** (H4) and no Copy MCP address (H11) exist in any app.

## 3. Lessons to check against

- **Header design** ([header/README.md](header/README.md)): H1 (the list from the account app), H4 (each app serves a manifest of its pages and actions, no sign-in, no data; the open app's server filters it), H5 (one sign-in cookie on the shared domain), H8 (without an account, the header shows only what the sign-in has), H11 (Copy MCP address as a palette action), H13 (now one theme per browser, from this design).
- **Accounts in the console**, C5: an account's theme lives in a browser cookie.
- **UI package design** ([ui-package/README.md](ui-package/README.md)): parts are props only, one copy of the tokens; a part decides nothing.
- **Decisions.**
  - 0012: argo is a ship; its sign-in is the console's alone.
  - 0013: minimal, no compatibility layers; what goes, goes.
  - 0022: the viewer reads only, with no theme switch.
  - 0033: logic on the app's server; the browser renders what it is given.
  - 0043: no micro frontends; each app serves its own pages.
  - 0049: three trains (core with ui and common, the gateway, the account app): a shared part reaches the gateway and the account app only at a released version, so each change lands in core's train first.
  - 0054: one sign-in for every app, the account app's cookie on the shared domain.
  - 0058: core stores no account.
- **Self-hosted.** No account app, one person as argo in the console (accounts design, A2); the apps may run on hosts that share no parent domain.
- **Interaction feedback (web-frontend skill).** A theme change shows at once; a palette entry that opens another app shows it is opening, as the AppSwitcher's choices do.

## 4. Decisions

Thomas, 15 Nov, in the app: every question below answered with option 1, the pick as proposed.

### The theme (issue 1125)

**H13 now reads: one theme per browser, in every app.** It replaces "the theme is per app"; [header design H13](header/README.md) points here.

- **T1. Where the theme is kept.** In one theme cookie on the shared domain (hosted: `aeolus-fleet.dev`, as H5's sign-in cookie), not httpOnly, set by any app's avatar menu and read by every app's root layout for the first paint. Where the apps share no parent domain (self-hosted on separate hosts), each host keeps its own. A new browser starts at System. Rejected: on the account in the account app (every first paint waits on it, argo has no account there, self-hosted has no account app); both.
- **T2. argo.** argo follows the browser's cookie like an account; `operators.theme` and `console.setTheme` go (0013). The theme is how this browser looks, not who acts in it. Rejected: argo keeps its theme on the server.
- **T3. The viewer.** Shows the browser's theme, still with no theme switch (0022). Rejected: follows the system.
- **T4. A tab open in another app.** Shows the new theme on its next load. Rejected: listening for the cookie's change (more than moving between apps asks).
- **T5. Where the code lives.** The cookie's name and reading it in `@aeolus-fleet/common/rules`; the first-paint script and applying it in `@aeolus-fleet/ui`, beside the tokens. Each app's root layout and avatar menu call them, with the shared domain from its own configuration. Rejected: a copy per app, how three cookies came about.

### ⌘K across apps and Copy MCP address (what is left of issue 1036)

- **A1. What an app's list holds** (H4's manifest). Every page in the app's navigation and every action its own palette offers, each with the rights it needs; no data (no ships, no parties). Rejected: top-level pages only.
- **A2. One palette.** `@aeolus-fleet/ui`'s CommandPalette takes every entry as props, grouped by app; the console's own palette goes onto it. The list's shape lives in common, and the rule that filters the lists by the apps list (H1) in `@aeolus-fleet/common/rules`, run on each app's server (0033). Rejected: each app keeps its own palette.
- **A3. Copy MCP address.** A palette action from the gateway's list, shown where the account may open the gateway (H11). Rejected: also an entry in the apps menu.

## 5. Mockups (stage 2)

Before (as built) left, after (this design) right; at 375 and 1440, light and dark. The sheets live on the branch `shots/1830`, images only.

**The avatar menu's theme choice across apps.** The person picks a theme in the console, then opens Bridge in the gateway, the account app, the console as argo, and the console as the viewer, in the same browser.

| | Light | Dark |
| --- | --- | --- |
| 1440 | [theme-1440-light.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/theme-1440-light.png) | [theme-1440-dark.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/theme-1440-dark.png) |
| 375 | [theme-375-light.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/theme-375-light.png) | [theme-375-dark.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/theme-375-dark.png) |

**The command palette across apps.** The console typing "mcp" and "rights", Bridge typing "fleet", the account app with nothing typed.

| | Light | Dark |
| --- | --- | --- |
| 1440 | [palette-1440-light.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/palette-1440-light.png) | [palette-1440-dark.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/palette-1440-dark.png) |
| 375 | [palette-375-light.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/palette-375-light.png) | [palette-375-dark.png](https://github.com/ThomasHendrickx/aeolus-fleet/blob/shots/1830/palette-375-dark.png) |

What the after side draws:

- **The theme.** The avatar menu and the phone's avatar sheet keep their Light, Dark and System choice; every app, argo and the viewer show the browser's one theme from the first paint.
- **The palette.** The open app's groups first, as today (Actions, Ships in the console, Go to), then one group per other app the account may open, under the app's name, each entry marked with the app it opens. Copy MCP address copies and says Copied, with no app opening. The gateway and the account app gain the palette and the header's search field (on the phone, the search button), as the console has them.

Drawn beyond the decisions, for Thomas to keep or drop:

- **M1. A line under Theme**, "This browser, every Aeolus app", so the person knows the choice holds across apps. Without it the menu is unchanged.
- **M2. Other apps' entries under the app's name, with the app named on each row** ("Console ↗"), rather than mixed into Actions and Go to.
