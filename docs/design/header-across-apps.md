# The theme and the apps across every Aeolus app

The design for [issue 1125](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1125) (carry the chosen theme across the Aeolus apps) and what is left of [issue 1036](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1036) (one Aeolus apps menu in every app), together because both live in the header every app shows ([header design](header/README.md)). Milestone core 0.40.0.

Stage 1: purpose, what exists, lessons and questions, for Thomas to agree the purpose first. No code, no mockups yet: the before and after screens come once the purpose is agreed.

## 1. Purpose (to agree)

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

**Purpose question for Thomas.** Issue 1036's body asks for the apps menu and Copy; the header design then put Copy in the palette (H11) and made the cross-app palette step 6 (H4). Is what is left of 1036 the cross-app palette plus Copy (pick), or only Copy, with the cross-app palette its own issue?

## 2. What exists today

At `c4f56dd27`, with the gateway and pagasae as the [UI package design](ui-package/README.md) (section 2) found them.

**The theme.**

- **Console, an account.** Kept in the browser cookie `aeolus_console_theme` (`packages/console/lib/browser-theme.ts`), a year, the console's host only: the accounts design's C5 ([Accounts in the console](accounts/console.md)), since core stores nothing of an account (0058).
- **Console, argo.** Kept on argo's operator row in core (`operators.theme`, `console.setTheme`, `packages/core/src/domain/identity/set-theme.ts`), so it follows argo to any browser. Signing in as argo swaps the account's theme for argo's: the "switching to argo" in the report.
- **Console, the viewer.** No theme; it follows the system (blueprint, Account and Console rows).
- **First paint.** The console's root layout reads the theme on the server (`lib/theme-of-session.ts`) and sets it before React hydrates (`themeScript` in `lib/theme.ts`).
- **Gateway and pagasae.** Each keeps its own theme cookie (issue 1125).
- **The header design** decided it this way: H13, "The theme is per app, as today (option 1)". Issue 1125 asks to change H13.
- **The avatar menu** (`packages/ui/src/molecules/avatar-menu.tsx`) shows the theme choice and hands it to the app (`onThemeChange`); each app keeps it its own way.

**The apps menu and ⌘K.**

- **The AppSwitcher** (`packages/ui/src/molecules/app-switcher.tsx`) is in the AppHeader of the console, the gateway and pagasae. Its list comes from pagasae's `GET /api/apps` (H1, shape `appsListSchema` in `packages/common/src/schemas/apps-list.ts`), shaped by `appSwitcherOf` (`@aeolus-fleet/common/rules`).
- **The console's CommandPalette** (`packages/console/features/commands/`) lists the console's pages and actions, then the other apps by name, from the switcher. `@aeolus-fleet/ui` also has a CommandPalette (`packages/ui/src/organisms/command-palette.tsx`).
- **No manifests** (H4) and no Copy MCP address (H11) exist in any app.

## 3. Lessons to check against

- **Header design** ([header/README.md](header/README.md)): H1 (the list from pagasae), H4 (each app serves a manifest of its pages and actions, no sign-in, no data; the open app's server filters it), H5 (one sign-in cookie on the shared domain), H8 (without an account, the header shows only what the sign-in has), H11 (Copy MCP address as a palette action), H13 (theme per app, the decision this design asks to change).
- **Accounts in the console**, C5: an account's theme lives in a browser cookie.
- **UI package design** ([ui-package/README.md](ui-package/README.md)): parts are props only, one copy of the tokens; a part decides nothing.
- **Decisions.**
  - 0012: argo is a ship; its sign-in is the console's alone.
  - 0013: minimal, no compatibility layers; what goes, goes.
  - 0022: the viewer reads only, with no theme switch.
  - 0033: logic on the app's server; the browser renders what it is given.
  - 0043: no micro frontends; each app serves its own pages.
  - 0049: three trains (core with ui and common, the gateway, pagasae): a shared part reaches the gateway and pagasae only at a released version, so each change lands in core's train first.
  - 0054: one sign-in for every app, pagasae's cookie on the shared domain.
  - 0058: core stores no account.
- **Self-hosted.** No pagasae, one person as argo in the console (accounts design, A2); the apps may run on hosts that share no parent domain.
- **Interaction feedback (web-frontend skill).** A theme change shows at once; a palette entry that opens another app shows it is opening, as the AppSwitcher's choices do.

## 4. Questions

Each has options and a pick. They are answered once the purpose is agreed; then the before and after mockups follow.

### The theme (issue 1125)

**T1. Where the chosen theme is kept.**

1. **One theme cookie on the shared domain** (hosted: `aeolus-fleet.dev`, as H5's sign-in cookie), not httpOnly, set by any app's avatar menu and read by every app's root layout for the first paint. Where the apps share no parent domain (self-hosted on separate hosts), each host keeps it, as today.
2. **On the account in pagasae**, so it follows the human to another browser. Every app's first paint then waits on pagasae, argo has no account there, and self-hosted has no pagasae.
3. Both: kept on the account, with the cookie for the first paint.

Pick 1: C5 already keeps an account's theme in the browser; one cookie name and one domain turn three cookies into one, with no new store and no server call before the first paint. A new browser starts at System, as it does today for an account.

**T2. argo's theme.**

1. **argo follows the browser's theme cookie** like an account; `operators.theme` and `console.setTheme` go (0013).
2. argo keeps its own theme on the server, as today; only accounts share the cookie.

Pick 1: the report names switching to argo as part of the defect. The theme is how this browser looks, not who acts in it.

**T3. The viewer.**

1. **The viewer shows the browser's theme cookie**, still with no theme switch (0022).
2. The viewer follows the system, as today.

Pick 1: the same browser shows the same theme; the viewer still changes nothing.

**T4. A tab already open in another app.**

1. **It shows the new theme on its next load.**
2. It changes at once, by listening for the cookie's change.

Pick 1: the report is about moving between apps, which is a load; listening across apps is more than the problem asks (0013).

**T5. Where the theme's code lives, so no app copies it.**

1. **The cookie's name and reading it in `@aeolus-fleet/common/rules`; the first-paint script and applying it in `@aeolus-fleet/ui`**, beside the tokens. Each app's root layout and avatar menu call them, with the shared domain from its own configuration.
2. Each app keeps its own copy of the same few lines.

Pick 1: one source of truth; a copy per app is how three cookies came about.

### ⌘K across apps and Copy MCP address (what is left of issue 1036)

**A1. What a manifest lists** (H4).

1. **Every page in the app's navigation and every action its own palette offers today**, each with the rights it needs.
2. Only each app's top-level pages.

Pick 1: the purpose is to find anything in any app; an app's own palette already says what it offers.

**A2. One palette for every app.**

1. **`@aeolus-fleet/ui`'s CommandPalette takes every entry as props**, grouped by app; the console's own CommandPalette goes onto it. The manifest's shape lives in common, and the rule that filters manifests by the apps list (H1) in `@aeolus-fleet/common/rules`, run on each app's server (0033).
2. Each app keeps its own palette and adds other apps' entries itself.

Pick 1: one part and one rule, as the AppSwitcher is today.

**A3. Where Copy MCP address shows.**

1. **A palette action, from the gateway's manifest, where the account may open the gateway** (H11 as decided).
2. Also an entry in the apps menu, beside Gateway, as issue 1036's draft had it.

Pick 1: H11 is decided; option 2 reopens it, so it is offered only as the question.
