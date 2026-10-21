# One header for every Aeolus app

The technical design for [issue 1036](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1036). Thomas approved the look on 21 Oct (the issue's comments): the switcher in the title ("Aeolus / Console ▾", the first part switches fleet, the second app), the command palette (⌘K: apps, pages and actions across every Aeolus app) and the avatar menu. This doc goes purpose first, then the lessons to check against, then the questions. Nothing below the purpose is decided until Thomas agrees the purpose and answers the questions. No code.

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

1. **A new package `@aeolus-fleet/header` in core's train** (aeolus-fleet repository, versioned with core, as common is): React parts, props only, the tokens' single copy, its Storybook stories. pagasae and the gateway pin an exact version, as they pin common. Changes decisions 0008 (packages) and 0049 (core's train gains a package).
2. **Its own repository and train**, per 0049's pattern. A header fix then releases alone, but it is one more repository, release workflow and minimum-version check for a small part.
3. **Inside `@aeolus-fleet/common`.** No new package, but common is schemas and ids, and React in it would pull React into core's server and every plugin.
4. **Copies per app, the design the one source.** Today's way for pagasae; four copies drift.

**Pick: 1.** The console is the first user and the design system already lives in aeolus-fleet; a header change usually comes with a console change. Versioning: semver with core's train; pagasae and the gateway move by a version bump in their own PR. The data the header needs (Q1's shape) is in common, so the header package depends on common's types only.

### Q3. How does the gateway render a React header?

The gateway's pages are HTML strings from Fastify, with no React and no client script.

1. **The gateway renders the header package on its server** (`react-dom/server`) into its page layout, and serves the package's prebuilt browser bundle for the menus and the palette, the bundle a file the package ships. One implementation; the gateway gains React as a dependency, only for the header.
2. **The package also ships a framework-free header** (an HTML renderer and a small script). No React in the gateway, but two implementations of one part.
3. **A web component** used by all three apps. One implementation, but not on the shadcn and Base UI atoms the console and pagasae use, so it looks and behaves apart from them.
4. **The gateway's pages move to Next.js.** One stack, but a rewrite of every gateway page for a header.

**Pick: 1.** One part, one look, and the gateway's pages stay as they are below the header. The gateway's pages adopt the tokens with it, so they stop carrying their own colours.

### Q4. How does the palette get pages and actions from each app?

1. **Each app serves a manifest of its pages and actions** (a fixed path, no sign-in: names, deep links, keywords, the rights each needs, no data). The open app's server reads the other apps' manifests, keeps them for a while, filters them by Q1's list and hands the palette only the entries to render (0033). An action in another app is a deep link (such as `?commission`); the target app checks rights on arrival and opens its dialog. Live data (ships, squadrons) stays the open app's own, as today.
2. **pagasae holds every app's pages** in its Q1 answer. One call, but pagasae then knows every app's routes, and each app's release has to update pagasae.
3. **The header package holds a static catalogue of every app's pages.** Simple, but a new gateway page needs a header release and a bump in every app: coupling.
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

### Q8. What does the header show without an account?

argo's own sign-in (self-hosted, no pagasae) and the viewer have no account.

1. **Only what that sign-in has:** the title shows the fleet and Console, without ▾; the palette shows the console's own entries; the avatar menu says "argo's own sign-in" or "Viewer", theme, shortcuts, help and sign out, without Your account, Your rights or Email updates.
2. **Hide the switcher and the avatar's account part entirely.**

**Pick: 1.** One header everywhere, empty where there is nothing to switch to.

### Q9. What does switching fleet mean in each app?

1. **A switch opens the same app for the other fleet through its way in** (Q5): the console signs in as argo of the other fleet, which ends this console sign-in (one console cookie at a time) and may sign someone out there (Q7); the gateway starts a page sign-in for the other fleet; Account and Admin show the other fleet's pages. When the account may not open this app in the other fleet, the switch goes to an app it may open there, Account at least.
2. **Fleet switching only in Account and Admin;** the console and the gateway show the fleet name without ▾.

**Pick: 1**, with the console's case for Thomas: leaving the console for another fleet's console ends this sign-in.

### Q10. What does the avatar menu say, in the domain language?

The approved text has "who you are and your role here". In the domain language, role is only a squadron member's (0050).

1. **"Signed in as argo", "Signed in as your account", "Viewer"**: how you are signed in here, with the account's name above it.
2. Keep "role" in the UI only.

**Pick: 1.** The same check for **Admin**: the installation admin's pages. The app name may stay Admin; the doc and code say installation admin.

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
