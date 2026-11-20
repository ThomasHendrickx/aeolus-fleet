# Moving between Aeolus apps

Status: stage 2 mockups, round 4, for [#1969](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1969), awaiting Thomas’s approval. Thomas approved purpose A and picks A for questions 1 to 5 on 19 Nov 2026. Implementation follows approved mockups. [Draft PR #1970](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1970) stays draft until that approval.

## 1. Purpose

A person can move from any Aeolus app to another app available to them without knowing or typing its address. They can find the same simple way to do this on phone and desktop, and tell which app and fleet they are in.

Switching apps should feel like moving within Aeolus. It should work for a self-hoster running only part of Aeolus as well as for someone using the hosted apps. It must respect how the person is signed in to each app and the access that app grants them.

## 2. Lessons to check against

### Current navigation, inspected read-only

This is a source inventory, not a claim about the deployed version or the session in which Thomas saw no switcher.

| Surface a person opens | What the source shows today |
| --- | --- |
| Console | Uses the shared header, but desktop chooses the `fleet` layout: a fleet-name menu containing fleets and apps, without the app-name dropdown. Phone root pages use `compact`, a bottom sheet. Without an available apps list it becomes plain text. Thus importing the switcher does not establish that a person can switch from their console session. |
| Gateway, including Bridge and outside-party pages | Signed-in header uses the shared `full` layout on desktop: separate fleet and app dropdowns. Phone uses `compact`. Signed-out, unreadable header data or no openable fleet falls back to a plain header without the switcher. Bridge is a gateway surface, not a separate deployment. |
| The hosted apps: account and administration pages | Signed-in pages use the shared `full` desktop layout and `compact` phone sheet. Signed-out pages have a sign-in bar. Administration destinations depend on access. |
| The hosted apps: the person's workspace | Source includes the shared `fleet` switcher in desktop navigation and header when supplied. The phone bar has branding and identity, with selected outward links under More, but no equivalent shared app switcher. |
| Self-hosted sign-in pages | Credential and return journey, rather than a persistent working app shell. Their inclusion in navigation is a scope question below. |
| Public information surfaces | Marketing, documentation, demos and status are browser surfaces too, but not signed-in fleet work. Their inclusion is a scope question below. |

The double dropdown is built once in [AppSwitcher](../../../packages/ui/src/molecules/app-switcher.tsx), `layout="full"`, and used by [AppHeader](../../../packages/ui/src/organisms/app-header.tsx) by default. `fleet` combines the two lists in one menu; `compact` uses a bottom sheet. None offers navigation when `canSwitch` is false.

Console consumers: [Header](../../../packages/console/components/organisms/header.tsx) and [TopBar](../../../packages/console/components/organisms/top-bar.tsx). Its [session hook](../../../packages/console/lib/app-switcher.ts) reads destinations only for an account session, not argo or viewer. Its [server adapter](../../../packages/console/lib/apps-list.ts) returns no list without a configured source, shared sign-in or successful response. The [shared model](../../../packages/common/src/rules/app-switcher.ts) then supplies the current app and fleet alone.

Gateway consumers: `web/features/frame/ui/gateway-header.tsx` through `web/features/frame/state/header.tsx` in the [public gateway repository](https://github.com/ThomasHendrickx/aeolus-fleet-gateway). Hosted consumers were inspected at their signed-in headers and workspace shell; private source names and addresses are intentionally omitted.

### Existing agreements and constraints

- [UI package](../../../packages/ui/README.md): `packages/ui` holds the part every app shows, props only. Each app supplies destinations and session facts through its own adapter. The shared part does not fetch or infer access.
- [Design system](../README.md) and [conventions](../conventions.md): use the shared parts and tokens; check keyboard navigation, visible focus, accessible names, 44 px phone targets, reduced motion and long names. A desktop dropdown already has a phone bottom-sheet counterpart. The simpler interaction must be reachable on both widths, including detail pages.
- [Header design](../header/README.md): preserve app and fleet orientation, links between independent apps and existing access checks. Its earlier two-dropdown choice is the choice #1969 asks to revisit, not permission to change unrelated behavior.
- Signed-in state belongs to the app being viewed. Account, argo, viewer, signed-out and expired sessions cannot be treated as interchangeable. A link does not grant rights or prove the destination has an active session. Existing shared sign-in should remain usable; app switching must not silently change identity.
- [Self-hosted sign-in design](../self-hosted-sign-in.md): a self-hoster may run console, gateway and sign-in without the hosted apps. An installation's actual apps and permitted destinations matter, not a fixed list of hosted addresses. A single available app is a valid installation.
- Current absence, loading and failure can all leave someone with no usable destination. Later mockups need to distinguish those conditions and cover one app, several apps, several fleets, restricted access and the session states above.

## 3. Current decisions

Thomas’s approved purpose and five picks:

| Question | Decision |
| --- | --- |
| 1. Purpose | A: reach every available Aeolus working app from every other, with the same discoverable interaction on phone and desktop and clear app/fleet context. |
| 2. Surfaces | A: Console, gateway including Bridge, and the hosted apps’ signed-in working pages. Sign-in pages retain their return journey; public information surfaces keep appropriate links. |
| 3. Entry point | A: one discoverable entry point for apps and fleets, clearly distinguished inside it. Existing fleet-switching behavior applies. |
| 4. Destinations unavailable | A: keep the entry discoverable, explain the actual state, and offer the applicable next step. A link promises no access and changes no identity silently. |
| 5. Smaller installations | A: show only configured destinations available to the person. Explain a single-app installation without disabled advertisements for uninstalled apps. |

## 4. Mockups awaiting approval

[Before/after screenshot index](mockups/README.md). These are browser screenshots of documentation fixtures, not a production build or captures of a deployed session. Before reconstructs the navigation source described above; the surrounding content is illustrative. After proposes the shared controls. Hosted apps appear only as generic apps, `App 1` and `App 2`; their page designs belong in their private repository.

### The note this round answers

"Mmmm not really there. I would put the switching of fleet in the same popup as where you change from application. One location to change app and fleet"

The grid launcher at the start of the bar opens one panel, "Apps and fleets", with the apps and the fleets in the same place, each in its own section. The bar names the app and the fleet you are in, next to the launcher. The account button at the end of the bar holds who is signed in and Sign out only. Icons are Lucide shapes the apps already load.

### The bar every app shows

Every working page opens with the same bar across the full width, above any sidebar.

```text
App adapter: apps + fleets + current app and fleet + session + state + actions
  The bar (AppHeader on desktop, the app's phone bar on phone)
    Start: launcher button (grid icon)  +  current app (icon, name)  +  current fleet (fleet icon, name)  +  the page's own part
      Desktop: a panel under the launcher / phone: a bottom sheet, titled "Apps and fleets"
        Apps: one tile per app, icon and name, current tile marked; inline app state and its action
        Fleets: one row per fleet, current checked; inline switching, failure and Try again
    End: account button (how signed in, avatar)
      Desktop: a panel under the button / phone: a bottom sheet
        Who is signed in; Sign out
```

- **The launcher** is the grid button at the very start of the bar. It reads "Apps and fleets" to a screen reader and as its tooltip. Pressing it opens the one place to change app and fleet.
- **Where you are** sits right after the launcher: the current app's icon and name, then the current fleet in a quiet pill with the fleet icon and its name, read as "Fleet: Aeolus". The fleet shows with a single fleet too. A long name ends in an ellipsis (220 px on desktop, 96 px on phone); the full name is in the panel. Then the page's own part: Console shows "/ Fleet"; Bridge shows its Bridge and Outside parties tabs, as today.
- **The Apps and fleets panel** has two sections, told apart by their headings, a divider, tiles against rows, and the app icon against the fleet icon:
  - **Apps**, "Apps you can open in Aeolus" (the fleet in view): tiles, three to a row, each with its icon and its name. The current app's tile is filled and says "Current".
  - **Fleets**, "Choose a fleet. You stay in Console where that fleet has it.": one row per fleet with the fleet icon, the current one checked and labelled "Current" ("Current fleet" to a screen reader). With one fleet the section has that one row and says "This is the only fleet you can open." Long names wrap. Choosing a fleet follows the existing [H9 rule](../header/README.md#h9-switching-fleet-ends-nothing-by-c1): the current app where available, otherwise an app the account may open. It changes no identity and ends no sign-in.
- **The account button** sits at the very end of the bar. On desktop it shows how the person is signed in ("Your account", "Signed in as argo", "Viewer", "Sign-in expired"), then the avatar; on phone the avatar alone. Pressing it opens who is signed in and Sign out. It holds no apps and no fleets.
- **Phone** has the same bar: launcher, app name, fleet pill, avatar, each control 44 px. The panel opens as a bottom sheet with handle, title, 44 px targets and Cancel last; tiles are larger and still three to a row.
- **Same control in every app.** Console, Bridge and the hosted apps show the same bar. Page titles and detail breadcrumbs stay in the page, so a detail page keeps the launcher and the account button.

The parts stay props only, in `packages/ui`: `AppHeader` holds the bar; the launcher and its panel grow from the existing `AppSwitcher`, whose `fleet` layout already holds apps and fleets in one menu; the account panel is the existing `AvatarMenu`, which already shows who is signed in and Sign out. The app adapter supplies the apps, fleets, current app and fleet, session, loading or error explanation, and the applicable retry or sign-in action. The parts render those facts and emit choices. They do not fetch, construct addresses, infer rights, inspect another app's session, or choose a different identity. They use `DropdownMenu` on desktop and `Sheet` on phone, with `Button`, `Skeleton` and the inline error look. No new atom, status colour or product term is proposed.

### Session and unavailable states

| State | Apps section | Fleets section, bar and account button | Applicable action |
| --- | --- | --- | --- |
| Several apps and fleets | Tiles for Console, Gateway, App 1 and App 2; current marked | Aeolus (checked) and Harbour; "Your account" | Open an app or a fleet |
| A single fleet | Unchanged | The one fleet, checked, and "This is the only fleet you can open." | Close |
| Single-app self-hosted installation | Console tile alone, current; "No other apps" and the installation explanation | Aeolus alone | Keep using Console or close |
| argo | Console tile alone; "Signed in as argo" and why other apps need an account | Aeolus alone; "Signed in as argo" | Keep using the session or close |
| Viewer | Console tile alone; "Viewer" and why other apps are not supplied | Aeolus alone; "Viewer" | Keep using the session or close |
| Missing app | That tile greyed with "Unavailable", no link; what failed, where you still are, Try again; other tiles stay | Unchanged | Try again, then updated tiles or the same inline error |
| Expired sign-in for an app | That tile greyed with "Sign-in required"; "Your sign-in has expired" and Sign in | "Sign-in expired" on the account button | Existing shared sign-in, returning to the requested app |
| Loading | Tile and row shapes as skeletons in both sections, "Loading apps and fleets…" | The bar keeps the current app and fleet | Wait or close; no empty claim |
| Read failure | One notice: "Couldn’t load apps and fleets", current page still open, Try again | The bar keeps the current app and fleet | Retry with busy icon, then both sections and "Apps and fleets refreshed.", or the inline error |

An expired request is not a separate credential system per app. [H5's shared account sign-in](../header/README.md#h5-one-account-sign-in-across-every-app-option-2) still applies. A retained page does not establish current authorization; the control shows the failure the app reports.

Argo and viewer do not acquire Bridge sessions. The Bridge frames for these cases show its account-required explanation and no working Bridge content; the panel shows Console as a configured app without a link and "No fleet: no account is signed in here.", the bar reads "No fleet" and the account button shows that no one is signed in. In a single-app installation, the Bridge frame explains that Bridge is not installed; Console offers no Gateway tile. H8's session limits and H5's Console-only argo rule remain.

### Feedback and accessibility

| Action | Immediate feedback and loading | End or failure |
| --- | --- | --- |
| Open the launcher or the account panel | Button shows pressed, panel appears, focus on the current app's tile or the first row; announced | Escape, outside press or Cancel closes it and returns focus to its button |
| Open an app | The tile says "Opening" with a busy icon, other tiles and the fleet rows wait, "Opening Gateway…" under the tiles; announced | The new app's bar names it after the launcher, focus on the launcher; a reported refusal stays inline with its next action |
| Open a fleet | The row reads "Opening Harbour" with a busy icon, other rows and the tiles wait, the fleet pill in the bar shows a busy icon, "Opening Harbour…" under the list; announced | The panel closes, the bar names Harbour, the page says "Console is open in Harbour.", focus returns to the launcher |
| A fleet fails to open | The rows return; "Couldn’t open Harbour", "You are still in Aeolus. Try again to open Harbour.", focus on Try again; announced | Try again keeps its label and gains a busy icon while the row reads "Opening Harbour" again; then arrival, or the same inline error |
| Try again after a read failure or a missing app | Button keeps its label and gains a busy icon; tile and row skeletons | "Apps and fleets refreshed." with both sections, or the inline error |
| Sign in | Button keeps its label and gains a busy icon | Existing sign-in returns to the requested app |
| Sign out | Row gains a busy icon, "Signing out…"; announced | Existing sign-out |
| Choose the current app or fleet | Panel closes; "already open" announced | The bar stays as it was |

Keyboard: the bar's order is launcher, the page's own part, account button. Enter or Space opens a button. In the panel the tiles are one tab stop and the fleet rows another: the arrow keys move between tiles (left, right, up and down by a row), Tab moves from the tiles to the current fleet, Up and Down move between fleets and Home and End jump to the first and last; Enter chooses; Escape closes and returns focus to the launcher. The phone sheet traps focus and ends with Cancel. Visible focus follows `--ring`. Every phone target is at least 44 px; states have words, not only icons. Reduced motion and the light and dark tokens apply.

The HTML, CSS and JS fixtures and the capture script live only in this documentation folder. They simulate choices, retries, sign-in and sign-out loading locally. No server, real app, credential or app behaviour is changed. No production implementation is authorized before Thomas approves these mockups.

### Where the account menu's items go

Status: approved by Thomas on 20 Nov 2026, with the three picks below. Thomas chose on 20 Nov 2026 that a mockup round places each item before the console slice builds anything. [Before and after screenshots](mockups/README.md#where-the-account-menus-items-go).

The approved account panel holds who is signed in and Sign out only, and stays as it is. Today's console account menu ([`useAccountMenu`](../../../packages/console/lib/account.tsx) filling [`AvatarMenu`](../../../packages/ui/src/molecules/avatar-menu.tsx)) holds more. Each item moves to a place the console already has: the Settings page, the sidebar and the phone tab bar. No new atom, colour or product term.

| Item today | Who has it today | Where it goes |
| --- | --- | --- |
| Theme (Light, Dark, System), the only place to change it | argo and an account; the viewer has none (0022) | Settings, first section "Theme", with the scope line it has today, "This browser, every Aeolus app", and the three buttons the phone sheet uses today. Applied at once, as today (T1 to T4 unchanged). The viewer sees the section with "A viewer sign-in shows this browser’s theme and has no theme switch." |
| Keyboard shortcuts | Desktop, every sign-in | Settings, section "Help", desktop only (H6), opening the same dialog. |
| Help | Every sign-in | Settings, section "Help", opening the documentation in a new tab, as today. |
| Take the tour | Where a guide is set for the session (0024) | Settings, section "Help", under the same rule; it opens the guide's first step, as today. |
| Your account, Your rights, Email updates | An account whose apps list names Account (H8) | Settings, section "Your account", "These pages open in Account.", under the same rule. ⌘K still finds them (A2). |
| Sign in as argo | An account allowed as argo in this fleet | Settings, section "Your account", last row, under the same rule, with "Signing in as argo" while it works. |
| Settings, phone only | A session that manages the fleet, with something to set | The phone tab bar's last tab, "Settings", for every sign-in. The sidebar's Settings item likewise shows for every sign-in. |
| Network, phone only | A session holding `fleet:network` while the networking plugin is connected | On phone, the first row of Settings, under the same rule. Desktop keeps its sidebar item. |

Settings then opens with the sections every sign-in has, then the installation's sections it holds today (argo's own sign-in, squadrons, the trierarch plugin, the gateway, the watch plugin), each under its own rule as today. Its description reads "How this console looks for you, and how this installation runs.", or "How this console looks for you." for a sign-in that manages nothing.

```text
Account menu today (sidebar foot on desktop, bottom sheet on phone)
  Who is signed in, This session ..................... stays: the account panel (approved, unchanged)
  Sign out ........................................... stays: the account panel (approved, unchanged)
  Your account, Your rights, Email updates ........... Settings > Your account (account with Account in its apps list)
  Sign in as argo .................................... Settings > Your account, last row (account allowed as argo)
  Take the tour ...................................... Settings > Help (a guide for the session)
  Theme: Light, Dark, System ......................... Settings > Theme (argo, account; viewer: a line, no switch)
  Keyboard shortcuts ................................. Settings > Help (desktop only)
  Help ............................................... Settings > Help (new tab)
  Settings (phone only) .............................. phone tab bar, last tab; sidebar item for every sign-in
  Network (phone only) ............................... phone: Settings, first row; desktop: sidebar item, unchanged

Settings, top to bottom
  [phone, fleet:network] Network >
  Theme              Light | Dark | System    (viewer: no switch)
  Help               [desktop] Keyboard shortcuts / Help / [guide] Take the tour
  Your account       [Account in the apps list] Your account / Your rights / Email updates
                     [allowed as argo] Sign in as argo
  Today's sections   argo's own sign-in, squadrons, trierarch plugin, gateway, watch plugin (their rules unchanged)
```

Per state:

| State | Settings shows | Phone tab bar |
| --- | --- | --- |
| Account | Theme; Help with Take the tour; Your account with its three pages and Sign in as argo; today's sections it manages | Fleet, Health, Trierarchs, Inbox, Settings |
| argo | Network on phone; Theme; Help with Take the tour; today's sections | The same |
| Viewer | Theme as a line without a switch; Help with Take the tour | The same |
| Single-app self-hosted, argo | Theme; Help with Take the tour; argo's own sign-in. No Your account section: there is no Account app | Fleet, Health, Inbox, Settings without the trierarch plugin |

The phone tab bar holds six tabs at most (squadrons and the trierarch plugin on); every label fits at 375 px and every tab stays 44 px.

| Choice | Immediate feedback | End |
| --- | --- | --- |
| A theme | The page shows it at once; the button is pressed; focus stays; "Theme: Dark" announced | Kept for this browser, as today |
| Keyboard shortcuts | The dialog opens with focus inside | Escape or Close returns focus to the row |
| Sign in as argo | The row reads "Signing in as argo" with a busy icon and is disabled | The existing argo sign-in |
| Take the tour | The guide's first step opens on its page, focus on Next | The guide, as today |

Questions this round put to Thomas, each with the pick he approved:

1. Settings for every sign-in, the viewer included, so the theme and Help have one home. Rejected: Settings for those who manage the fleet only, which leaves the viewer and an account that manages nothing without Help, Take the tour and Keyboard shortcuts.
2. Settings as the phone tab bar's last tab. Rejected: a row in the account panel, which the approved panel does not hold.
3. Network on phone as the first row of Settings. Rejected: a sixth or seventh tab.

Thomas approved these three picks on 20 Nov 2026; the console slice builds them.
