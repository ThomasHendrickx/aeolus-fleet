# Moving between Aeolus apps

Status: stage 2 mockups for [#1969](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1969), awaiting Thomas’s approval. Thomas approved purpose A and picks A for questions 1 to 5 on 19 Nov 2026. Implementation follows approved mockups. [Draft PR #1970](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1970) stays draft until that approval.

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

[Before/after screenshot index](mockups/README.md). These are browser screenshots of documentation fixtures, not a production build or captures of a deployed session. Before reconstructs the navigation source described above; the surrounding content is illustrative. After proposes the shared control. Hosted apps appear only as generic destinations, `App 1` and `App 2`; their page designs belong in their private repository.

### One part in every working header

The existing `AppSwitcher` in `packages/ui` remains props only. The app adapter supplies the current app and fleet, destinations it can safely offer, session description, loading or error explanation, and applicable retry or sign-in action. The part renders those facts and emits choices. It does not fetch, construct destination addresses, infer rights, inspect another app’s session, or choose a different identity.

```text
App adapter: destinations + current context + state + actions
  AppHeader / phone TopBar
    AppSwitcher: one button, app / fleet, chevron
      Desktop: DropdownMenu
      Phone: bottom Sheet
        Apps: current mark + destination links
        Fleets: current mark + destination links
        Inline state + applicable action
```

- The trigger reads `Console / Aeolus` in Console and `Gateway / Aeolus` in Bridge. Bridge stays the gateway’s page, identified by its existing navigation. The phone trigger stacks app and fleet in one 44 px target. Page titles and detail breadcrumbs stay separate, so a detail page never loses this control.
- Opening the trigger reveals both groups together. Desktop uses the existing DropdownMenu; phone uses the existing Sheet with handle, title, 44 px rows and Cancel last. Current choices have a check and an accessible current label. Long names wrap in the list and truncate in the trigger while retaining its full accessible name.
- Only configured, permitted destinations are offered. A smaller installation has no placeholders for uninstalled apps. The single-app state is an explanation reached through the same trigger, rather than an inert title.
- Selecting an app follows its adapter-supplied address. Selecting a fleet follows the existing [H9 rule](../header/README.md#h9-switching-fleet-ends-nothing-by-c1): the current app where available, otherwise an app the account may open. It changes no identity and ends no sign-in.
- While the browser opens a destination, keep the chosen row and its name, add `Opening <name>` with a busy icon, announce it, and block duplicate choices. The destination’s normal header confirms the app and fleet after arrival. The arrival notice in the fixture marks this transition for review; it does not add a cross-app notification service.

### Session and unavailable states

| State | What the person sees | Applicable action |
| --- | --- | --- |
| Several apps and fleets | Current app and fleet, Apps and Fleets in one menu or sheet; generic hosted destinations only | Open an app or fleet |
| Single-app self-hosted installation | Console and Aeolus as current; “No other apps” and the installation explanation | Keep using Console or close the control |
| argo | “Signed in as argo”; only Console and its fleet; explanation that this sign-in is Console-only | Keep using the existing session or close the control |
| Viewer | “Viewer”; only Console and its fleet; explanation that other destinations are not supplied for this session | Keep using the existing session or close the control |
| Missing destination | Unavailable destination without a stale link, what failed, current location, and refresh action; other known destinations remain available | Try again, then updated destinations or the same inline error |
| Expired destination request | Actual sign-in failure reported by the app, “Your sign-in has expired”, the requested app, and Sign in | Existing shared sign-in with the requested destination as its return journey |
| Loading | Stable trigger and headings, skeletons in the destination rows’ shapes, “Loading apps and fleets…” | Wait or close; no empty-state claim |
| Read failure | “Couldn’t load destinations”, current page still open, and Try again | Retry with the button label retained and busy icon, then a refreshed list or inline error |

An expired request is not a separate credential system per app. [H5’s shared account sign-in](../header/README.md#h5-one-account-sign-in-across-every-app-option-2) still applies. A retained page does not establish current authorization. The control presents the actual failure supplied by the app rather than diagnosing expiry itself.

Argo and viewer do not acquire Bridge sessions. The Bridge frames for these cases show its account-required destination explanation and no working Bridge content. In a single-app installation, the Bridge frame explains that Bridge is not installed; it is not an offered destination in Console. These comparison fixtures establish the boundary, not a new sign-in page or flow. The working-page scope and existing credential return journeys remain as approved.

The discoverable trigger and inline explanations replace only H8’s inert-title presentation. H8’s session limits and H5’s Console-only argo rule remain applicable. A destination not known to this session is never borrowed from another identity in the browser.

### Feedback and accessibility

| Interaction | Immediate feedback and loading | End or failure |
| --- | --- | --- |
| Open menu or sheet | Expanded trigger, visible panel, focus on a choice or applicable action; no read if destinations already supplied | Escape, outside press or Cancel closes it and returns focus to the trigger |
| Open app or fleet | Named row changes to Opening with busy icon, other destinations wait; polite announcement | Destination header identifies app/fleet; a reported refusal remains inline with its next action |
| Refresh destinations | Try again retains its label and gains a busy icon; row skeletons retain group headings | Refreshed list with inline confirmation, or the actionable inline read error |
| Sign in | Sign in retains its label and gains a busy icon before leaving | Existing sign-in returns to the requested destination; cancelled or failed sign-in remains in its existing return journey |
| Choose current app/fleet | Close the control and announce that the choice is already open | Current header remains visible |
| Cancel or close | Panel disappears and focus returns to its trigger immediately | No destination or identity changes; there is no asynchronous work to load |

Use Base UI’s keyboard behavior in the eventual shared part: Enter/Space on the trigger, arrow navigation in the desktop menu, Escape to close, and trapped focus in the phone Sheet. Visible focus follows `--ring`. All phone actions are at least 44 px; state labels accompany icons. The fixture uses reduced motion and the existing light/dark tokens, Geist, Lucide path shapes, Button, Skeleton, InlineError, DropdownMenu and Sheet conventions. No new atom, status color or product term is proposed.

The HTML/CSS/JS fixtures and capture script live only in this documentation folder. They simulate choices, retries and sign-in loading locally. No server, real destination, credential or app behavior is changed. No production implementation is authorized before Thomas approves these mockups.
