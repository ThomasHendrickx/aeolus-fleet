# One header for every Aeolus app

The technical design for [issue 1036](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1036). Thomas approved the look on 21 Oct (the issue's comments): the switcher in the title ("Aeolus / Console ▾", the first part switches fleet, the second app), the command palette (⌘K: apps, pages and actions across every Aeolus app) and the avatar menu. This doc goes purpose first, then the lessons to check against, then the questions; part 5 does the same for several accounts in one fleet's console, which Q7 and Q9 wait on. Nothing below the purpose is decided until Thomas agrees the purpose and answers the questions. No code.

## 1. Purpose

A human of an organisation uses several Aeolus apps, each on its own address, with its own sign-in. Today each app has its own top bar, and the only way between them is a link on pagasae's account page. The purpose:

- **One way around.** From any page of any Aeolus app, a human reaches every other app and fleet they may open, in one or two presses, and sees which app and fleet they are in.
- **One way to find things.** ⌘K finds an app, a page or an action in any Aeolus app, not only the one open.
- **One place for who you are.** The avatar menu says who is signed in here and how, and leads to the account's own pages (Your account, Your rights, Email updates), theme, keyboard shortcuts, help and sign out.
- **One part, not four copies.** The header is built once and looks and behaves the same in every app, so a change lands everywhere by a version bump, not by hand in four repositories.

The apps, and where each runs today:

| App | Repository | Built with | Signed in as |
| --- | --- | --- | --- |
| Console | aeolus-fleet (`packages/console`) | Next.js, React, shadcn on Base UI | argo (an allowed account's ticket, or argo's own sign-in) or the viewer (0012, 0022, 0054) |
| Gateway pages | aeolus-fleet-gateway | Fastify, server-rendered HTML strings (`src/adapters/http/html.ts`), no React, its own small style | An account, through pagasae, per fleet (`aeolus_gateway_session`; "the pages are accounts only", Thomas, 20 Oct) |
| Account | pagasae (private) | Next.js, React, its own copies of the shadcn atoms and of `tokens.css` | An account, by sign-in link |
| Admin | pagasae today (the owner's pages: Fleets, Health, Waiting list, Emails, Settings); "the coming admin area" | as Account | The installation admin's account |

Not the purpose: one sign-in for every app (each keeps its own, decision 0054), a shell that renders other apps inside it (0043 rejected micro frontends), or new rights. The header shows and links; each app still decides what its pages allow.

## 2. What exists today

- **Console.** `components/organisms/header.tsx` (breadcrumb, live status, ⌘K trigger, Compose), the AccountMenu in the Sidebar on desktop and behind the TopBar Avatar on phone, and `features/commands` (the CommandPalette with ships, actions and pages, from the console's own reads).
- **pagasae.** `features/app-shell` (AppBar, AccountMenu, OwnerNav, OwnerTabBar), built after the console's design, on its own copies of the atoms and the tokens.
- **Gateway.** One `layout(title, body)` with an inline style; no header part, no client script.
- **A link between them already.** The console's server asks pagasae for an account's name server to server (`GET /api/console/account-name` with `CONSOLE_TOKEN`), and pagasae's Open console asks core for a sign-in ticket and sends the browser to the console.

## 3. Lessons to check against

Each answer below is checked against these. A pick that breaks one says so.

- **Decisions.** 0013: minimal, no compatibility layers, flag paid-product polish. 0043: core is the fleet, its API and argo's console; no micro frontends, the console does not render other apps. 0049: one repository and version per release train, others consume `@aeolus-fleet/common` from npm at a stated version. 0050: one meaning per term (role is only a squadron member's; session only an agent run, a human has a sign-in; installation admin, not owner). 0054 and 0058: pagasae signs accounts in, core stores no account and no email. 0012: one console sign-in as argo at a time, a new one ends the last, whoever's. 0022: the viewer reads only. 0057: every call authorised for its actor, read from the server.
- **Ports and adapters.** Where the list of apps and fleets comes from is a port of each app; pagasae, or nothing, behind an adapter. The header part itself holds no fetch, no store and no API client: props only, like every shared part (web-frontend).
- **Console logic on the server (0033).** Which apps and fleets an account may open, and other apps' palette entries, are read and parsed on each app's server. The browser gets only what the header renders; zod and outside answers stay out of client chunks.
- **No package coupling.** The header part must not make the console depend on pagasae or the gateway, or the reverse; it depends on nothing of theirs, and none of them reads another's internals.
- **One source of truth.** One header part, one copy of the tokens, one list of what an account may open. Today pagasae copies the atoms and `tokens.css`; the design should not add a third copy.
- **Interaction feedback (web-frontend v3.4.0).** Switching app or fleet, signing out, a theme change and every palette action are actions: pending on the control within 100 ms, disabled while it runs, a visible outcome, a failure that says what went wrong and what to do. The palette's results load with a skeleton, never a blank. Each interactive state has a story and an interaction test.

## 4. Questions

Numbered, each with options and my pick. Q1, Q2, Q4, Q5 and Q6 are the ones the task names.

### Q1. Where does the list of apps and fleets an account may open come from?

1. **pagasae answers it, server to server.** One pagasae endpoint, asked by each app's server with that app's token and the account's id: the account's fleets (each fleet where a group or its own rights give anything, as the gateway's sign-in already finds them), and per fleet the apps it may open: Console where it is allowed as argo, Gateway where it has rights, Account always, Admin for the installation admin. The shape lives in `@aeolus-fleet/common`. Without pagasae (self-hosted, argo's own sign-in), the app's adapter answers only itself and its own fleet.
2. **Core answers it.** Core knows fleets and scopes. But core stores no account (0058) and knows neither who is allowed as argo nor who is the installation admin.
3. **Each app works it out.** The gateway from its sign-in claims, the console from its sign-in, pagasae from its database. Three answers to one question, and they drift.

**Pick: 1.** pagasae is the one place that knows accounts, their fleets, who may sign in as argo and who the installation admin is; the account-name endpoint is the precedent. Sub-question: authenticate with each app's token plus the account id (works for the console, whose argo sign-in holds an account id but no account token), or with the account's pagasae token (the gateway holds one, the console does not). I pick the app token, as account-name does.

### Q2. How do three repositories share one header part?

Thomas, 21 Oct: "why cant that be part of common? I dont see the point of yet another package." No new package: the header is a subpath of `@aeolus-fleet/common`.

- **`@aeolus-fleet/common/header`**, a subpath export beside `.` and `./rules`: the header's React parts, props only, the atoms they stand on, the tokens' single copy and its Storybook stories. Versioned with common, in core's train; pagasae and the gateway already pin common, so a header change reaches them by the same bump.
- **React only for those who import it.** `react`, `react-dom`, `@base-ui/react` and `lucide-react` are optional peer dependencies of common. Core, the trierarch, squadrons, the trierarch plugin and every other server-only user import `.` or `./rules`, never `./header`, so they neither install nor load React. Common's own `dependencies` stay zod alone.
- **Client-safe by construction (0033).** Nothing under `src/header` imports zod, `../schemas`, common's root (`.`, which re-exports the schemas), Node built-ins or server code. It may import React, Base UI, lucide, `../rules`, and types only (`import type`) from the rest of common: Q1's and Q4's shapes are schemas in common, and the header sees only their inferred types.
- **The gateway's server render** (Q3) imports the same subpath, with `react-dom/server`.
- **One copy of the atoms and tokens.** The atoms the header uses (Button, DropdownMenu, Sheet, Dialog, Avatar, Kbd, Tooltip) and `tokens.css` move from the console into `src/header`, and the console imports them from there. pagasae drops its own copies as it adopts the header.
- **One Tailwind source.** The console and pagasae scan the subpath's built files for classes (`@source`); common also ships the header's built CSS for the gateway, which runs no Tailwind.

What it changes:

- **architecture.md.** The overview's "`@aeolus-fleet/common` holds what both share: schemas, ids and types" and the packages table's common row ("Zod schemas for every procedure, prefixed id helpers, shared types, error codes, event names"; depends on "Nothing but Zod") gain the header: "and the header every Aeolus app shows (`@aeolus-fleet/common/header`, React parts, client-safe)"; its dependencies become "Zod; React, Base UI and lucide as optional peers, for `./header` only". The console's row says it takes the header and its atoms from common. Decision 0008 keeps its package count.
- **Lint, proposed (a new rule is Thomas's to approve).** No rule keeps `./rules` zod-free today; 0033 checks it with the bundle analyzer. A new block in `eslint.config.js`, `aeolus/common-header`, on `packages/common/src/header/**`, uses the existing `importRules` helper (static, `import()` and `import('x')` types alike) to refuse `zod`, `node:*`, `@prisma/*`, `@trpc/*`, `../schemas/**`, `../fleet/**`, `../trierarch/**`, `../ids/**` and common's root, allowing `import type` from them; and on the rest of common, refusing `react`, `react-dom`, `@base-ui/react`, `lucide-react` and `./header/**`, so the server side never pulls React in. A test in the existing lint tests proves each refusal. Applying the same block to `src/rules` would make 0033's rule for it a lint error too; I would propose that separately.

Options considered: a new package in core's train (one more package for one part); its own repository and train (one more release workflow and version check); copies per app (four copies drift).

### Q3. How does the gateway render a React header?

The gateway's pages are HTML strings from Fastify, with no React and no client script.

1. **The gateway renders `@aeolus-fleet/common/header` on its server** (`react-dom/server`) into its page layout, and serves the header's prebuilt browser bundle and CSS for the menus and the palette, files common ships. One implementation; the gateway gains React as a dependency, only for the header.
2. **Common also ships a framework-free header** (an HTML renderer and a small script). No React in the gateway, but two implementations of one part.
3. **A web component** used by all three apps. One implementation, but not on the shadcn and Base UI atoms the console and pagasae use, so it looks and behaves apart from them.
4. **The gateway's pages move to Next.js.** One stack, but a rewrite of every gateway page for a header.

**Pick: 1.** One part, one look, and the gateway's pages stay as they are below the header. The gateway's pages adopt the tokens with it, so they stop carrying their own colours.

### Q4. How does the palette get pages and actions from each app?

1. **Each app serves a manifest of its pages and actions** (a fixed path, no sign-in: names, deep links, keywords, the rights each needs, no data). The open app's server reads the other apps' manifests, keeps them for a while, filters them by Q1's list and hands the palette only the entries to render (0033). An action in another app is a deep link (such as `?commission`); the target app checks rights on arrival and opens its dialog. Live data (ships, squadrons) stays the open app's own, as today.
2. **pagasae holds every app's pages** in its Q1 answer. One call, but pagasae then knows every app's routes, and each app's release has to update pagasae.
3. **The header subpath holds a static catalogue of every app's pages.** Simple, but a new gateway page needs a common release and a bump in every app: coupling.
4. **The palette in the browser asks each app live.** Each app needs its own sign-in from another origin (CORS, cookies); breaks 0033.

**Pick: 1.** Each app owns what it offers, no app knows another's internals, and the browser gets only rendered entries. The manifest's shape lives in common. Searching another app's live data (a ship from the gateway's pages) is out of scope until asked.

### Q5. How does sign-in work across apps?

1. **Each app keeps its own sign-in; a switch goes through the target app's way in.** To the gateway or Account: the browser goes to that app, which signs in through pagasae without a prompt while the pagasae sign-in lasts. To the console: through pagasae's Open console (a sign-in ticket naming the account, 0054). Only accounts allowed as argo see Console.
2. **One sign-in for all apps** (a shared cookie on the parent domain). Breaks 0012 and 0054: the console's sign-in is argo's lease, not an account's, and the gateway's is per fleet.
3. **The console as an account, not as argo.** The console would need account pages and rights checks; 0043 keeps core's console argo's.

**Pick: 1.** It needs no new sign-in, only links to existing ways in. Two unhappy paths need Thomas, so they are their own questions: Q7 (opening the console ends another account's argo sign-in) and Q8 (signed in with no account).

### Q6. What does the header do at phone width?

1. **The same three parts, phone patterns** (design system: DropdownMenu is desktop only, the same items open in a bottom Sheet). The title shows the app name with ▾ and drops the fleet name below 640 px; a tap opens one bottom Sheet with the fleets, then the apps. The palette opens full screen from the search icon, as the console's TopBar does today. The avatar opens its bottom Sheet, plus the destinations a tab bar lacks, as today's console AccountMenu does. In the console's TopBar detail and modal modes the switcher gives way to back and Close.
2. **No switcher on phone;** apps and fleets move into the avatar Sheet. Fewer parts, but a second way to switch to learn.

**Pick: 1.** It follows the design system's existing phone rules and keeps one way to switch at every width. Touch targets 44 px, no Kbd hints on phone.

### Q7. Opening the console takes argo's sign-in over from someone else. What does the header do?

0012: one console sign-in as argo at a time, and a new one ends the last, whoever's.

1. **Say it before the switch:** when another account is signed in as argo of that fleet, the switch asks "Open the console? This signs <name> out of it." with Open and Cancel.
2. **Switch at once;** the other account sees "signed in elsewhere" on their console, as today.

**Pick: 1**, for Thomas: it is product behaviour. It needs pagasae, or core, to say whether argo of that fleet is signed in now, which neither offers today.

Thomas, 21 Oct: "Investigation needed: what is needed that multiple accounts can have the console of a fleet open at the same time?" Answered by part 5, C1.

### Q8. What does the header show without an account?

argo's own sign-in (self-hosted, no pagasae) and the viewer have no account.

1. **Only what that sign-in has:** the title shows the fleet and Console, without ▾; the palette shows the console's own entries; the avatar menu says "argo's own sign-in" or "Viewer", theme, shortcuts, help and sign out, without Your account, Your rights or Email updates.
2. **Hide the switcher and the avatar's account part entirely.**

**Pick: 1.** One header everywhere, empty where there is nothing to switch to.

### Q9. What does switching fleet mean in each app?

1. **A switch opens the same app for the other fleet through its way in** (Q5): the console signs in as argo of the other fleet, which ends this console sign-in (one console cookie at a time) and may sign someone out there (Q7); the gateway starts a page sign-in for the other fleet; Account and Admin show the other fleet's pages. When the account may not open this app in the other fleet, the switch goes to an app it may open there, Account at least.
2. **Fleet switching only in Account and Admin;** the console and the gateway show the fleet name without ▾.

**Pick: 1**, with the console's case for Thomas: leaving the console for another fleet's console ends this sign-in.

Thomas, 21 Oct: first answer Q7, which decides this one. Answered by part 5, C1.

### Q10. What does the avatar menu say, in the domain language?

The approved text has "who you are and your role here". In the domain language, role is only a squadron member's (0050).

1. **"Signed in as argo", "Signed in as your account", "Viewer"**: how you are signed in here, with the account's name above it.
2. Keep "role" in the UI only.

**Answered (Thomas, 21 Oct): 1.** The same check for **Admin**: the installation admin's pages. The app name may stay Admin; the doc and code say installation admin.

### Q11. Does the MCP connector address stay?

The issue's body offers "the MCP connector address with Copy"; the approved menu does not list it.

1. **A palette action, "Copy MCP address"**, from the gateway's manifest, shown where the account may open the gateway.
2. **An item in the avatar menu.**
3. **Drop it** from this issue.

**Pick: 1.** It is an action of the gateway's, and the palette is where actions live.

### Q12. Are plugin pages apps?

Squadrons and the trierarch plugin show in the console today; 0043 says plugins serve their own pages.

1. **Not now:** the switcher lists Console, Gateway, Account and Admin. A plugin that serves pages of its own joins later by serving a manifest (Q4), with no header change.
2. **List them now.**

**Pick: 1.** Nothing to list yet.

### Q13. Where does the theme live?

1. **Per app, as today:** each app saves its own (the console on its sign-in, pagasae in its cookie).
2. **One theme for the account,** kept by pagasae and read by every app.

**Pick: 1.** Minimal (0013); a human sets it once per app. Option 2 is polish for later.

## 5. Several accounts in one fleet's console

Thomas asked this about Q7: "what is needed that multiple accounts can have the console of a fleet open at the same time? This feels again like a left over from the ship decisions in the beginning when the whole product was very simple." This part answers it the same way: purpose, what is true today, lessons, questions. It decides Q7 and Q9.

### 5.1 Purpose

Several humans of one organisation manage one fleet in the console at the same time. Each signs in as their own account and acts with that account's scopes and reach (0052, 0058), and each event names that account. argo stays the break-glass sign-in: one at a time, the fleet's fail-safe (0057), used when the accounts cannot act.

Not the purpose: new rights, a page per person (0043 rejected it), or moving messaging into the console. A human's messages stay their person ship's, through the app that crews it (0054).

### 5.2 Why one console sign-in ends another today

Every console sign-in today is a sign-in of a ship, argo or the viewer. A sign-in as argo is argo's crew.

- **The console is argo's crew (0012).** "argo is always crewed: the console is its crew", "One operator console session: sign-in ends the previous one and takes the lease over". Decision 0010 allows one open lease per ship and makes argo the one exception that may take a lease over.
- **The code that ends it.** `core/src/domain/identity/start-console-session.ts:37-46`, in one transaction:
  - `consoleSessions.endAll(...)` with reason `takenOver` ends every open sign-in on argo's ship (`adapters/prisma/identity.ts:164-170`);
  - then `takeOverOperatorLease` (`domain/registry/leases.ts:30-56`) ends argo's lease with `LeaseRevoked`, returns each delivery it held in flight to pending with `DeliveryReturned`, and opens a new lease with no crew token (`ShipClaimed`).
- **The database backs it.** `console_sessions_fleet_id_open_key` allows one open sign-in per fleet that holds a lease (`schema.prisma:816-817`), and `leases_ship_id_open_key` allows one open lease per ship.
- **What hangs on argo's lease.** The inbox actions `fleet.markRead`, `fleet.markDone` and `fleet.reply` take only a crew caller (`trpc.ts:620-633`) whose ship is the operator (`mark-done.ts:38`, `reply-to-message.ts:41`). `markDone` holds the lease while it runs (`mark-done.ts:41`). Compose sends as argo.
- **The leftover Thomas suspects.** `schema.prisma:759-760`: "One account per fleet in v1". The console was built when every caller was a ship. Decision 0057 then made an account an actor of its own, but the console never followed: it presents no account token (nothing in `packages/console` reads one). Its one call to pagasae is the account-name lookup.
- **The viewer is apart already.** Viewer sign-ins hold no lease and many run at once (0022). They sit outside the unique index and outside `endAll`, so they show that a console sign-in without argo's lease works.

So a console sign-in ends another only because it is a sign-in as argo, and argo is one ship with one lease. Nothing in the console needs one sign-in except argo's crew and its inbox.

### 5.3 What it takes

**Core already has most of it.**
- It checks account tokens on every call (`domain/identity/authenticate-account.ts:35-68`: signature, fleet, end, cut-off).
- 31 fleet procedures already take an account: the actor-scoped ones, including list, commission, release, retire, labels, the network rules, explainReach and events.
- Events already record an account actor (`events.actor_account_id`).

**What is missing.**

1. **A console sign-in as an account.** The console signs the human in through pagasae (OpenID Connect, as the gateway's pages do) and gets an account token for the fleet, plus a fresh one before it ends. No lease and no argo.
2. **The token on every call, browser path included.** The browser calls core directly over `/trpc` and its WebSocket, with the httpOnly cookie (0012: no proxy). So the console's server sets the account token as an httpOnly cookie on the shared domain, renewed before its 10 minutes end. Core reads the token from that cookie as it reads `aeolus-account-token` today, with the same origin check on mutations. The WebSocket already resolves its caller again on each wake (`trpc.ts:437-446`): a token that ends ends the stream, and the client reconnects with the fresh cookie.
3. **The reads the console needs, opened to accounts.** 25 fleet procedures refuse an account today (`shipOf`, `trpc.ts:470-475`). Of these, the console needs about 18 for accounts: ship, shipTimeline, shipMessages, message, shipWay, needsAttention, health, dismiss, resend, inbox, ping, limits, crewRequest, removeCrewRequest, explainCrewRequest, recrew, clearWorktree and assignCrew. The trierarch's own calls (reportCrewStatus, confirmCrewRelease and the like) stay a ship's. Each moves to the actor check with the scope it has now; the check itself is the same one (0057).
4. **`console.session` and `console.account` answer an account.** Kind `account`, the account id, its scopes from the token. The console's pages and plugin calls read these: `lib/access.ts` gates by scopes today, so pages follow the account's scopes with no page logic of their own.
5. **Plugins accept the account.** The console's server forwards the cookie to squadrons and the trierarch plugin, which check `console.session` (0043 says plugin pages check a person by their account token already). Each plugin repository gets a small change and a raised minimum core version (docs/compatibility.md).
6. **Per-sign-in state.** Notice dismissals and guide progress are keyed by the console sign-in (`schema.prisma:913-926`, `948-960`); for an account, by its account id instead, the one fact about an account core may keep (0058). The theme is on argo's `operators` row; for an account it stays in a browser cookie, as pagasae keeps it.
7. **argo, unchanged, as break-glass.** An allowed account's ticket or argo's own sign-in, one at a time, taking argo's lease. Ending another argo sign-in still happens, but only between two humans who both chose break-glass.

**What changes:**

| Part | Change | Size |
| --- | --- | --- |
| Decisions | 0012: the console signs in accounts, and argo's sign-in becomes the break-glass way in instead of the console being argo's crew. 0043: core's console serves every account its scopes allow, still no page per person. 0054: a console sign-in through pagasae, beside argo's ticket. 0057: an actor is an account by its token, from a header or the console's cookie. 0058: who presents the token now includes the console. 0010 and 0022 stand | S |
| Core | Account token from a cookie; 18 procedures to the actor check; `console.session` and `console.account` for an account; notices and guide keyed by account id; tests per procedure for an account in and out of reach | M |
| Console | pagasae sign-in and refresh (route handlers, 0033); the token cookie; the avatar menu for an account (Q10); argo-only parts (inbox actions, Compose as argo) shown only to argo; sign-in page offers both ways in | M |
| pagasae | The console as an OpenID Connect client; Open console signs in as the account, and "sign in as argo" stays for allowed accounts | S |
| Squadrons, trierarch plugin | Accept an account's sign-in from the forwarded cookie; raise the minimum core version | S each |

### 5.4 What could break

- **Audit actor.** Nothing breaks: an account's event names the account (`actor_account_id`), and argo's events keep naming the account that signed in as argo (`actor_signed_in_account_id`). The timeline shows the account's name from pagasae, as the console already does for argo's sign-ins (`lib/account-name.ts`).
- **Live events.** The stream is authorised by `fleet:read`, not by argo's lease, so it works for an account. It drops every 10 minutes at the token's end and reconnects; the live status shows Reconnecting for a moment unless the cookie is renewed before the end, which is the plan. While pagasae is down, accounts lose the console as their last token ends (0058); argo's sign-in still works where argo's own sign-in exists, and hosted only through pagasae's ticket, as today.
- **The viewer.** Unchanged: its own ship and sign-ins (0022). A named person who only reads is an account with `fleet:read` (0050).
- **argo's inbox.** It is argo's: what reaches it is a failing of the system (0057). Accounts with `fleet:read` can read it, as the viewer can (`read-inbox.ts:22-29`), but Done and Reply stay argo's (C3).
- **Messaging.** An account sends as its person ship, whose lease the gateway holds (0054), so the console cannot send for it without a second crew (C4).
- **Cookies.** Two cookies on the shared domain: argo's `aeolus_session` and the account's. One browser may hold both, and C2 decides which one a call takes.
- **"Signed in elsewhere"** stays for argo only; an account's console sign-in ends only by sign-out, its token's end with pagasae down, or a cut-off (0055).

### 5.5 Lessons to check against

- **0057.** A human acts as their account; argo is never a normal path. Today the console makes argo the normal path for every human who manages a fleet.
- **0058.** Core stores no account and no email; the token is checked on every call. Keying notices and the guide by account id is the one stored fact, and 0058 allows an id.
- **0012 and 0010.** One crew per ship stays true; only argo's own sign-in keeps taking argo's lease.
- **0033.** The token is fetched, renewed and parsed on the console's server; the browser holds only an httpOnly cookie it cannot read.
- **0043.** No page per person: the console shows the fleet, gated by scopes, not a person's own pages.
- **0013.** No compatibility layer: argo's sign-in stays as it is, accounts are added, nothing runs two ways.
- **Interaction feedback.** Signing in, switching fleet and renewing must never leave a control silent; a renewal that fails says so and offers to sign in again.

### 5.6 Questions

**C1. Do accounts sign in to the console?** (decides Q7 and Q9)

1. **Yes, as their accounts**, with argo as break-glass (5.3).
2. **No.** The console stays argo's, and accounts manage through the gateway's pages and plugin pages. That needs a second admin surface, against 0043.
3. **Several sign-ins as argo at once.** Ends 0012's single crew: argo's lease would be shared, and argo stays the normal path, against 0057.

**Pick: 1.** It removes the leftover, keeps argo the fail-safe, and core already checks the token on every call. With it, Q7 becomes: opening the console signs you in as your account and ends no one's sign-in; only "Sign in as argo" warns when someone else is signed in as argo (Q7 option 1, for break-glass only). Q9 becomes: switching fleet in the console signs in to the other fleet as the same account, and ends nothing.

**C2. How does the browser carry the account's token to core?**

1. **An httpOnly cookie** on the shared domain, set and renewed by the console's server; core reads it beside the header.
2. **The console's server proxies every call**, the WebSocket included, adding the header. That breaks 0012's direct browser path and adds a hop to every live event.
3. **The browser holds the token** and sends the header. Script-readable credentials, against the httpOnly rule.

**Pick: 1.** When both cookies are present, argo's sign-in wins: it is the one the human chose to break glass with, and signing out of argo falls back to the account.

**C3. What does an account see of argo's inbox?**

1. **Read only, with `fleet:read`**, as the viewer sees it; Done and Reply only signed in as argo.
2. **Nothing**; only argo's sign-in shows it.
3. **Done and Reply for accounts holding a new scope.** Makes argo's inbox a normal path, against 0057.

**Pick: 1.** A failure stays visible to everyone who reads the fleet; acting on it stays break-glass.

**C4. Does the console send messages for an account?**

1. **Not now.** Compose shows only to argo, and an account messages from the gateway's pages or their own app, through their person ship (0054).
2. **Through the gateway**, which holds the person ship's lease: the console's server asks the gateway to send. That is a new gateway call.
3. **The console crews the person ship too.** Two crews for one ship, against 0010.

**Pick: 1**, with option 2 as a follow-up once someone asks.

**C5. Where are an account's theme, notice dismissals and guide progress kept?**

1. **Theme in a browser cookie; dismissals and guide progress in core, keyed by account id.**
2. **All in browser storage.** Lost on another browser, and the guide's progress is server state today (0024).
3. **Theme in pagasae for every app** (Q13 option 2).

**Pick: 1.** It keeps 0024 and 0023 as they are, with one more key.

**C6. Order of work**

1. **Accounts in the console first, then the header.** The header's switcher and avatar menu depend on what a console sign-in is.
2. **The header first, on today's argo sign-in,** then accounts. The switcher's console case would be redone.

**Pick: 1.** It is the backbone the header sits on, and it needs its own approved design with the full flow (sign-in, renewal, pagasae down, cut-off, break-glass).
