# Moving between Aeolus apps

Status: stage 2 mockups, round 2, for [#1969](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1969), awaiting Thomas’s approval. Thomas approved purpose A and picks A for questions 1 to 5 on 19 Nov 2026. Implementation follows approved mockups. [Draft PR #1970](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1970) stays draft until that approval.

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

### Round 2: Thomas's notes on round 1

1. "I expect a more microsoft office 365 like experience"
2. "I am missing screens for app"

Round 2 answers the first note here: the app launcher and the fleet and account button below. Screens for the hosted apps belong in their private repositories. The pattern follows how Microsoft 365 lays out its bar; no Microsoft name, mark or icon is used. Icons are Lucide shapes the apps already load.

### The bar every app shows

Every working page opens with the same bar across the full width, above any sidebar.

```text
App adapter: apps + fleets + current app and fleet + session + state + actions
  The bar (AppHeader on desktop, the app's phone bar on phone)
    Start: app launcher button (grid icon)  +  current app's icon and name  +  the page's own part
      Desktop: a panel under the button / phone: a bottom sheet
        Apps: one tile per app, icon and name, current tile marked; inline state and its action
    End: fleet and account button (fleet name, how the person is signed in, avatar)
      Desktop: a panel under the button / phone: a bottom sheet
        Who is signed in; Fleet: one row per fleet, current marked; Sign out
```

- **The app launcher** is the grid button at the very start of the bar. It reads "Apps" to a screen reader and as its tooltip. Pressing it opens a panel of tiles, three to a row: every app this person can open in the fleet in view, each with its icon and its name. The current app's tile is filled and says "Current" under its name. Nothing else lives in this panel: no fleets, no account, no settings.
- **The current app** sits right after the launcher, with its icon and name, so the person always sees which app they are in. Console shows "Console / Fleet"; Bridge shows "Gateway" with its own Bridge and Outside parties tabs, as today.
- **The fleet and account button** sits at the very end of the bar. On desktop it shows the fleet's name over how the person is signed in ("Your account", "Signed in as argo", "Viewer", "Sign-in expired"), then the avatar. On phone it shows the fleet's name and the avatar. Pressing it opens a panel with who is signed in, the fleets they can open with the current one checked, and Sign out. Choosing a fleet follows the existing [H9 rule](../header/README.md#h9-switching-fleet-ends-nothing-by-c1): the current app where available, otherwise an app the account may open. It changes no identity and ends no sign-in.
- **Phone** has the same two buttons in the same places, each 44 px. Each opens the same content as a bottom sheet with handle, title, 44 px targets and Cancel last; tiles are larger and still three to a row.
- **Same control in every app.** Console, Bridge and the hosted apps show the same bar. Page titles and detail breadcrumbs stay in the page, so a detail page keeps both buttons.

This keeps pick 3's single discoverable place for apps and fleets, read the way Thomas asked: apps and fleets are clearly told apart by living at opposite ends of the bar, the way Microsoft 365 keeps its app launcher apart from the account. Both buttons are always present and always in the same place.

The parts stay props only, in `packages/ui`: `AppHeader` holds the bar; the launcher grows from the existing `AppSwitcher`; the fleet and account panel grows from the existing `AvatarMenu`, which already shows who is signed in and Sign out. The app adapter supplies the apps, fleets, current app and fleet, session, loading or error explanation, and the applicable retry or sign-in action. The parts render those facts and emit choices. They do not fetch, construct addresses, infer rights, inspect another app's session, or choose a different identity. They use `DropdownMenu` on desktop and `Sheet` on phone, with `Button`, `Skeleton` and the inline error look. No new atom, status colour or product term is proposed.

### Session and unavailable states

| State | Apps panel | Fleet and account | Applicable action |
| --- | --- | --- | --- |
| Several apps and fleets | Tiles for Console, Gateway, App 1 and App 2; current marked | Your account; fleets Aeolus (checked) and Harbour | Open an app or a fleet |
| Single-app self-hosted installation | Console tile alone, current; "No other apps" and the installation explanation | Aeolus alone | Keep using Console or close |
| argo | Console tile alone; "Signed in as argo" and why other apps need an account | "Signed in as argo", Aeolus alone | Keep using the session or close |
| Viewer | Console tile alone; "Viewer" and why other apps are not supplied | "Viewer", Aeolus alone | Keep using the session or close |
| Missing app | That tile greyed with "Unavailable", no link; what failed, where you still are, Try again; other tiles stay | Unchanged | Try again, then updated tiles or the same inline error |
| Expired sign-in for an app | That tile greyed with "Sign-in required"; "Your sign-in has expired" and Sign in | "Sign-in expired" under the fleet | Existing shared sign-in, returning to the requested app |
| Loading | Title and tile shapes as skeletons, "Loading apps…" | Unchanged | Wait or close; no empty claim |
| Read failure | "Couldn’t load apps", current page still open, Try again | Unchanged | Retry with busy icon, then tiles or inline error |

An expired request is not a separate credential system per app. [H5's shared account sign-in](../header/README.md#h5-one-account-sign-in-across-every-app-option-2) still applies. A retained page does not establish current authorization; the control shows the failure the app reports.

Argo and viewer do not acquire Bridge sessions. The Bridge frames for these cases show its account-required explanation and no working Bridge content; the launcher shows Console as a configured app without a link, and the fleet and account button shows that no one is signed in. In a single-app installation, the Bridge frame explains that Bridge is not installed; Console offers no Gateway tile. H8's session limits and H5's Console-only argo rule remain.

### Feedback and accessibility

| Action | Immediate feedback and loading | End or failure |
| --- | --- | --- |
| Open the launcher or the fleet and account panel | Button shows pressed, panel appears, focus on the first tile or row; announced | Escape, outside press or Cancel closes it and returns focus to its button |
| Open an app | The tile says "Opening" with a busy icon, other tiles wait, "Opening Gateway…" under the tiles; announced | The new app's bar names it at the start; a reported refusal stays inline with its next action |
| Open a fleet | The row reads "Opening Harbour" with a busy icon, other rows wait; announced | The bar's end names the new fleet |
| Try again | Button keeps its label and gains a busy icon; tile skeletons | "Apps refreshed." with the tiles, or the inline error |
| Sign in | Button keeps its label and gains a busy icon | Existing sign-in returns to the requested app |
| Sign out | Row gains a busy icon, "Signing out…"; announced | Existing sign-out |
| Choose the current app or fleet | Panel closes; "already open" announced | The bar stays as it was |

Keyboard: Enter or Space opens either button; in the launcher the arrow keys move between tiles (left, right, up and down by a row), Tab leaves the grid; Escape closes. The phone sheet traps focus. Visible focus follows `--ring`. Every phone target is at least 44 px; states have words, not only icons. Reduced motion and the light and dark tokens apply.

The HTML, CSS and JS fixtures and the capture script live only in this documentation folder. They simulate choices, retries, sign-in and sign-out loading locally. No server, real app, credential or app behaviour is changed. No production implementation is authorized before Thomas approves these mockups.
