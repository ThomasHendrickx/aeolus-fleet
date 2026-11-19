# Moving between Aeolus apps

Status: stage 1 proposed for [#1969](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1969). Purpose awaits Thomas's approval. The picks below are proposals. Mockups follow agreement on the purpose; implementation follows approved mockups.

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

## 3. Open questions for Thomas

### 1. Does this purpose describe the problem to solve?

- **A.** Reach every available Aeolus working app from every other, with the same discoverable interaction on phone and desktop and clear app/fleet context.
- **B.** Only make the existing two dropdowns easier to use where they already appear.
- **Pick: A.** The reported need to type addresses is a coverage problem as well as an interaction problem. This is the purpose to agree before mockups.

### 2. Which surfaces should “every app” include?

- **A.** Console, gateway including Bridge, and the hosted apps' signed-in working pages. Sign-in pages retain their return journey; public information surfaces keep links appropriate to their purpose.
- **B.** Those working pages plus sign-in, marketing, documentation, demos and status, all with the same switcher.
- **Pick: A.** It covers the places a person works without making a credential page or an independently available status page depend on a signed-in app catalogue.

### 3. Should app switching and fleet switching share one entry point?

- **A.** One discoverable entry point for moving between apps and fleets, with the two choices clearly distinguished inside it.
- **B.** One app entry point, with fleet switching kept separately visible.
- **Pick: A.** It replaces the finicky adjacent controls and gives phone and desktop the same place to start. The contents and exact presentation remain for mockups; this does not decide a new fleet-switching flow.

### 4. What should someone see when their current app session cannot supply destinations?

- **A.** Keep the navigation entry discoverable, explain the actual state and offer the applicable next step. Do not promise access or silently switch identity.
- **B.** Keep today's plain title with no navigation until destinations are available.
- **Pick: A.** Otherwise argo, viewer, expired sessions or an unavailable catalogue can recreate the address-typing problem. Which destinations are safe to offer in each state needs agreement before detailed design; this proposes no new rights or sign-in rules.

### 5. How should an installation with fewer apps appear?

- **A.** Offer only configured destinations available to that person, with a clear single-app state when there is nowhere else to go.
- **B.** Show the complete hosted app list, with missing apps disabled or advertised.
- **Pick: A.** A self-hoster's smaller installation should be complete on its own terms, without dead links or suggestions that apps they never installed are broken.
