# One header for every Aeolus app

The technical design for [issue 1036](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1036), decided by Thomas on 21 Oct. He first approved the look, in the issue's comments:
- the switcher in the title ("Aeolus / Console ▾": the first part switches fleet, the second app);
- the command palette (⌘K: apps, pages and actions across every Aeolus app);
- the avatar menu.

Then he answered every question below. The design stands on [Accounts in the console](../accounts/console.md): every human signs in as their account, in every app. No code.

## 1. Purpose (decided)

- **One way around.** From any page of any Aeolus app, a human reaches every other app and fleet they may open, in one or two presses, and sees which app and fleet they are in.
- **One way to find things.** ⌘K finds an app, a page or an action in any Aeolus app, not only the one open.
- **One place for who you are.** The avatar menu says who is signed in here and how. It leads to the account's own pages (Your account, Your rights, Email updates), and holds the theme, keyboard shortcuts, help and sign out.
- **One part, one stack.** The header is built once and looks and behaves the same in every app, and every Aeolus web app is built the same way (part 5).

The apps:

| App | Repository | For | Built with |
| --- | --- | --- | --- |
| Console | aeolus-fleet (`packages/console`) | Fleet managers: one fleet and its ships | Next.js |
| Gateway | aeolus-fleet-gateway | Outside parties, a person's messages and requests | Next.js (part 5; HTML strings from Fastify today) |
| Account | pagasae | Every account: its fleets, rights and email updates | Next.js |
| Admin | pagasae | The App admin: the Aeolus application and all fleets | Next.js |

**Names (Thomas, 21 Oct):**

- **App admin:** manages the Aeolus application and all fleets.
- **Fleet manager:** manages one fleet and its ships.
- **Ship owner:** owns one ship within a fleet.

These replace two older names:
- "installation admin" and "installation owner", for the human who runs the application;
- "fleet owner", for the human who manages a fleet.

Decision 0050 and the blueprint's domain language take them in the first slice that builds this.

Not the purpose:
- a shell that renders other apps inside it (0043 rejected micro frontends);
- new rights. The header shows and links; each app still decides what its pages allow.

## 2. What exists today

- **Console.**
  - `components/organisms/header.tsx`: breadcrumb, live status, ⌘K trigger, Compose.
  - The AccountMenu: in the Sidebar on desktop, behind the TopBar Avatar on phone.
  - `features/commands`: the CommandPalette.
- **pagasae.** `features/app-shell` (AppBar, AccountMenu, OwnerNav, OwnerTabBar), built on its own copies of the atoms and of `tokens.css`.
- **Gateway.**
  - Its pages are HTML strings from Fastify (`src/adapters/http/html.ts`): one `layout(title, body)` with its own inline style, no React.
  - Live updates come over a `/live` WebSocket.
  - It has its own page sign-in, `aeolus_gateway_session`.
- **Links between them.**
  - The console's server asks pagasae for an account's name, server to server.
  - pagasae's Open console asks core for a sign-in ticket.

## 3. Lessons checked against

- **Decisions.**
  - 0013: minimal, no compatibility layers.
  - 0033: logic on the server, zod in no client chunk.
  - 0043: no micro frontends.
  - 0049: release trains; common from npm at a stated version.
  - 0050: one meaning per term.
  - 0054 and 0058: pagasae signs accounts in; core stores no account.
  - 0057: every call authorised for its actor.
- **Ports and adapters.** The header is props only; each app reads its data behind its own port.
- **No package coupling.** No app depends on another's package or internals.
- **One source of truth.** One header, one copy of the tokens and atoms, one list of what an account may open.
- **Interaction feedback (web-frontend v3.4.0).**
  - Every switch, palette action, theme change and sign-out shows pending within 100 ms and ends in a visible outcome.
  - The palette loads with a skeleton.
  - Each state has a story and an interaction test.
- **Thomas, H3.** Every Aeolus web app is the same stack.

## 4. Decisions

### H1. The list of apps and fleets an account may open: from pagasae (option 1)

One pagasae endpoint, read by each app's server, answers the account's fleets: each fleet where a group or the account's own rights give anything. Per fleet, it answers the apps the account may open:
- Console where it holds `fleet:read`;
- Gateway where it has rights;
- Account always;
- Admin for the App admin.

The shape lives in `@aeolus-fleet/common`. Each app's server asks with the account's shared sign-in (H5), so pagasae answers for the human signed in. Without pagasae (self-hosted, one person as argo), the app's adapter answers only the console and its own fleet.

Rejected:
- core answers it: core stores no account (0058);
- each app works it out: three answers that drift.

### H2. The header is a subpath of common

Thomas: "why cant that be part of common? I dont see the point of yet another package."

- **`@aeolus-fleet/common/header`**, beside `.` and `./rules`. It holds:
  - the header's React parts, props only;
  - the atoms they stand on (Button, DropdownMenu, Sheet, Dialog, Avatar, Kbd, Tooltip);
  - the single copy of `tokens.css`;
  - their Storybook stories.

  It is versioned with common, in core's train. The console imports the atoms and tokens from it; pagasae and the gateway drop their own copies.
- **React only for those who import it.** `react`, `react-dom`, `@base-ui/react` and `lucide-react` are optional peer dependencies of common. Server-only users import `.` or `./rules`, never `./header`, so they never install or load React: core, the trierarch, squadrons, the trierarch plugin and the rest. Common's own dependencies stay zod alone.
- **Client-safe (0033).**
  - Nothing under `src/header` imports zod, `../schemas`, common's root (which re-exports the schemas), Node built-ins or server code.
  - It may import React, Base UI, lucide and `../rules`.
  - From the rest of common it takes types only (`import type`).
- **Tailwind.** Each app scans the subpath's built files for classes (`@source`).
- **architecture.md.**
  - The overview's "schemas, ids and types" gains "and the header every Aeolus app shows (`@aeolus-fleet/common/header`, React parts, client-safe)".
  - Common's row in the packages table depends on "Zod; React, Base UI and lucide as optional peers, for `./header` only".
  - The console's row says it takes the header and its atoms from common.
  - Decision 0008 keeps its package count.
- **Lint (Thomas approved).** Two blocks on the existing `importRules` helper, proven by `lint/common-header.test.ts`.
  - `aeolus/common-header`, on the header's production files (`packages/common/src/header/**`, not its tests or stories): refuses `zod`, `node:*`, `@prisma/*` and `@trpc/*`, and a value import, re-export or `import()` of `../schemas/**`, `../fleet/**`, `../trierarch/**`, `../ids/**` and common's root; `import type` passes.
  - `aeolus/common-without-react`, on the rest of common: refuses `react`, `react-dom`, `@base-ui/react`, `lucide-react` and the header.

Rejected: a new package in core's train; its own repository and train; copies per app.

### H3. The gateway's pages move to Next.js (option 4)

Thomas: "... there was worse text here before I deleted it and type this ... This is UNACCEPTABLE. ALL web apps are the same. This whole gateway release ... why could this go so wrong. I have no idea. There is zero excuse for this slop"

Every Aeolus web app uses the same stack: Next.js, the web-frontend skill and the design tokens. Part 5 holds the gateway's move, its scope and its order.

Rejected, because each keeps the gateway apart from the other apps:
- server-rendering the header into the HTML strings;
- a second, framework-free header;
- a web component.

### H4. Palette entries: each app serves a manifest (option 1)

Each app serves its pages and actions at a fixed path, with no sign-in: names, deep links, keywords and the rights each needs, no data.

- The open app's server reads the other apps' manifests and keeps them for a while.
- It filters them by H1's list and hands the palette only the entries to render (0033).
- An action in another app is a deep link. The target app checks rights on arrival and opens its dialog.
- Live data (ships, squadrons) stays the open app's own.
- The manifest's shape lives in common.

Rejected: pagasae holding every app's pages; a static catalogue in the header; the browser asking each app live.

### H5. One account sign-in across every app (option 2)

Thomas: "account is the account your option 1 feels like accepting technical debt and just building on top of it. If I am wrong please correct me."

He is right. With accounts as the sign-in everywhere (the accounts design's C1 and C2), a sign-in per app is the old shape kept alive.

- **One sign-in.**
  - A human signs in once, through pagasae.
  - pagasae keeps that sign-in in one httpOnly, Secure cookie on the domain every Aeolus app shares (hosted: `aeolus-fleet.dev`).
  - Every app's server reads it and asks pagasae, server to server, for the account and an account token for the fleet in view.
  - Core reads that token from its own short cookie or a header (the accounts design, A3).
- **Every app takes it:** the console, the gateway's pages, Account and Admin.
  - The gateway's own page sign-in (`aeolus_gateway_session`) goes.
  - Its OAuth for outside MCP clients stays as it is: clients are not browsers.
- **Sign-out anywhere is sign-out everywhere.** pagasae ends the sign-in; each app's next renewal finds it gone.
- **Switching app is a link,** with nothing to sign in to again.
- **argo stays console-only.**
  - Signing in as argo is break-glass, in the console alone: by an allowed account's ticket (0054) or, self-hosted, argo's own sign-in.
  - Its `aeolus_session` cookie and its one lease stand (0012).
  - The gateway's `/parties` page for argo becomes a page for accounts holding the scopes it needs.
- **Self-hosted, with no pagasae,** has no account sign-in. One person signs in to the console as argo (the accounts design, A2).

Rejected: a sign-in per app; the console as argo's alone.

### H6. Phone width: the same three parts, phone patterns (option 1)

- The title shows the app name with ▾ and drops the fleet name below 640 px. A tap opens one bottom Sheet: the fleets, then the apps.
- The palette opens full screen from the search icon.
- The avatar opens its bottom Sheet, plus the destinations a tab bar lacks.
- In the TopBar's detail and modal modes, the switcher gives way to back and Close.
- Touch targets are 44 px. There are no Kbd hints on phone.

### H7. Opening the console ends no one's sign-in (by C1)

Thomas asked: "what is needed that multiple accounts can have the console of a fleet open at the same time? This feels again like a left over from the ship decisions in the beginning when the whole product was very simple." The investigation became [Accounts in the console](../accounts/console.md).

Opening the console signs you in as your account, beside anyone else. Only "Sign in as argo" warns, when someone else holds argo (the accounts design, A7).

### H8. Without an account, the header shows only what the sign-in has (option 1)

This covers argo's sign-in and the viewer.
- The title shows the fleet and Console, without ▾.
- The palette shows the console's own entries.
- The avatar menu says "Signed in as argo" or "Viewer". It has theme, shortcuts, help and sign out, without Your account, Your rights or Email updates.

### H9. Switching fleet ends nothing (by C1)

The same app opens for the other fleet with the same account sign-in (H5). When the account may not open this app in the other fleet, the switch goes to an app it may open there, Account at least.

### H10. The avatar menu says how you are signed in here (option 1)

"Signed in as argo", "Signed in as your account" or "Viewer", with the account's name above it. Role is only a squadron member's (0050).

### H11. "Copy MCP address" is a palette action (option 1)

It comes from the gateway's manifest and shows where the account may open the gateway.

### H12. Plugin pages are not apps yet (option 1)

The switcher lists Console, Gateway, Account and Admin. A plugin that serves pages of its own joins later by serving a manifest (H4), with no header change.

### H13. The theme is per app, as today (option 1)

Each app saves its own.

## 5. The gateway's pages on Next.js

**Purpose.** The gateway's pages look, behave and are built like every other Aeolus web app, so the header (H3) and the shared sign-in (H5) fit them with no special case.

**Scope.**

- **A Next.js app in the gateway's repository,** beside its Fastify server, released in the gateway's train.
  - It follows the web-frontend skill: vertical by feature.
  - It takes the header, atoms and tokens from `@aeolus-fleet/common/header`.
- **The Fastify server keeps the gateway's doors:** the MCP endpoint, OAuth for outside MCP clients, the A2A and REST surfaces, and its tRPC API.
  - The Next.js app calls that API from its server (0033). That is one API door, with no logic in the pages.
- **Every page moves, keeping what it does:** `/overview`, the parties pages (`/parties`, outside parties, one party), adding a server, a delivery, the sign-in pages, the authorize waiting page and the not-found page.
  - The `/live` channel becomes the app's live updates over the gateway's API.
- **Signing in is H5's shared sign-in.**
  - The gateway's page session and `aeolus_gateway_session` go.
  - Its argo page goes to accounts, by scope.
- **Not in scope: new gateway behaviour.** Each page keeps what it does today, and gains the design system's look and the interaction feedback rule.

**Order of work**, one slice each:

1. **Accounts in the console:** its own design, the backbone C6 put first.
2. **pagasae:** the shared account sign-in (H5) and the list of apps and fleets (H1).
3. **`@aeolus-fleet/common/header`:** the atoms and tokens move from the console (H2), and the console takes the header.
4. **The gateway's Next.js app:**
   - the frame and the shared sign-in first;
   - then the pages, one by one;
   - then the Fastify pages and `aeolus_gateway_session` go.
5. **pagasae takes the header** and drops its copies of the atoms and tokens.
6. **The manifests and the cross-app palette** (H4, H11).

Steps 4 and 5 can run side by side once step 3 is released.
