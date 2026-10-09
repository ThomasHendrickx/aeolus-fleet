# @aeolus-fleet/console

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) operator web app (Next.js). It reaches the server only through its tRPC API at `/trpc`.

Pre-v1: the console arrives after the v1 acceptance test passes. Until then it has:

| Path | What |
| --- | --- |
| `/sign-in` | Sign in with the operator email and password; the session crews `argo`. Only a session cookie stays in the browser |
| `/` | The fleet overview, live over a WebSocket: every ship with status, type, and where a crewed ship's session runs or an awaiting ship's prompt status, updated without a reload; search and filters in the URL; commission a ship; each ship's actions behind their dialogs: get a new starting prompt for a ship awaiting crew (shown once with its crew line; asks first while an unclaimed one is out), release or re-crew a crewed ship (re-crew shows a fresh prompt once), and retire any ship but `argo` (the ship's name typed to confirm when it still has open deliveries; retired ships show under Show retired); sign out from the account menu. Without a session it sends you to `/sign-in`, which says so when you signed in somewhere else |
| `/ships/[shipId]` | A ship's page, live: status, type, where its session runs, since when, when it was commissioned and its id, and how its last ping stands; Ping, Get starting prompt, Re-crew, Release, Rename (live name check and typed confirm) or Retire; a Timeline tab with every change to the ship, newest first, and a Messages tab with its messages grouped into threads by reply. A message opens in a side sheet (`?message=`) with its envelope, payload (formatted JSON or raw) and the history of its delivery, and Reply, which opens Compose with its sender as the recipient and the message it answers |
| `/needs-attention` | Needs attention, live: every undeliverable delivery, oldest first, with its message, claims and since when. Resend sends it again as a new message from its sender; Dismiss lets it go; either removes it from the list with a toast. Its count shows in the Sidebar and TabBar on every page |
| `/inbox` | argo's operator inbox, live: the messages ships sent to argo, Open, Done or All (`?filter=`), two panes on desktop and a list with a pushed message page on phone (`?message=`). Opening one marks it read; Mark as unread undoes that; Mark done or Reply (plain text to the sender) acknowledges it. Its open count shows in the Sidebar and TabBar on every page |
| `/health` | Web up, plus the server's health. Nothing about fleets |
| `/version` | The web process's version, plus the server's answer from its `/api/version` (its version, common's, and the latest applied migration), or `server: null` when it does not answer. Nothing about fleets |

## Running from npm

The package holds the console already built, as Next.js's standalone output (`.next/standalone`): the server, the browser's files and only the modules the server runs, Next.js and React among them. Installing it installs nothing else, about 35 MB instead of 300 MB and more with Next.js and its build tooling. It knows no server address until it runs:

```sh
npm install @aeolus-fleet/console
AEOLUS_SERVER_URL=https://fleet.example.com PORT=3000 npx aeolus-console start
```

`aeolus-console start` runs the standalone server (`.next/standalone/packages/console/server.js`), without Next.js telemetry, until `SIGINT` or `SIGTERM`. An image can copy `.next/standalone` alone and run that `server.js` with `node`, setting `PORT` and `HOSTNAME`.

## Configuration

Environment variables, read when the app runs, never when it is built:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AEOLUS_SERVER_URL` | `http://localhost:4000` | The Aeolus server. The browser calls its `/trpc` there, with credentials, and follows the fleet over a WebSocket to the same path (`ws://` or `wss://`), and the web app's `/health` asks its `/health` (at `AEOLUS_SERVER_INTERNAL_URL` when set), so both must reach it. Behind one host with the server, it is the server's public URL. On another host, the server needs `COOKIE_DOMAIN` and `CONSOLE_ORIGIN` for the console (see the server README) |
| `AEOLUS_SERVER_INTERNAL_URL` | `AEOLUS_SERVER_URL` | Where the web app's server reaches the server, for its own calls: `/health`, `/version`, the operator's theme and connecting squadrons. Server side only; the browser always uses `AEOLUS_SERVER_URL`. Set it when the public address routes back through a proxy in front of the web app, for example `http://server:4000` inside Compose, so `/health` on web does not loop |
| `AEOLUS_HOSTED_SIGN_IN_URL` | unset | A hosted console's sign-in, at the hosting service (pagasae for hosted Aeolus). Set, `/sign-in` redirects there at once and no password form is served; the hosting service hands the operator back with a one-time ticket at `/sign-in/ticket?ticket=...`, and a failed hand-off links back here. Unset, the console signs in with a password |
| `AEOLUS_HOSTED_ACCOUNT_URL` | unset | A hosted operator's account page, where the fleet's limits are listed. Set, the account menu offers Your account, opening it, and the console's limit notices (Commission at the ship limit, the overview and Compose at the daily message limit) and the overview's limit meters link to it with View limits; unset, there is no Your account and no View limits link |
| `AEOLUS_HOSTED_ANALYTICS_PROVIDER` | unset | The console's usage analytics, for a hosted install (decision 0025): `posthog` is the only provider. Unset, or with the key or host missing, the console sends no analytics at all |
| `AEOLUS_HOSTED_ANALYTICS_KEY` | unset | The provider's project key, read by the web app's server only |
| `AEOLUS_HOSTED_ANALYTICS_HOST` | unset | The provider's https address, such as `https://eu.i.posthog.com`. The web app's server sends there; the browser only ever posts to the web app's own `/api/analytics` |
| `AEOLUS_SQUADRONS_URL` | unset | Where squadrons runs, read by the web app's server only: the browser never calls squadrons. Unset means the console has no squadrons. Settings then connects it: the web app's server commissions the management ship (`squadrons`, with `fleet:read` and `fleet:manage`) or gives it a new starting prompt, and hands its secret to squadrons server to server; no one sees the secret. It reaches the server at `AEOLUS_SERVER_INTERNAL_URL` (or `AEOLUS_SERVER_URL`) from the web app's server too |
| `AEOLUS_TRIERARCH_PLUGIN_URL` | unset | Where the trierarch plugin runs, read by the web app's server only: the browser never calls it. Unset means the console has no trierarch plugin. Settings then connects it: the web app's server commissions its ship (`trierarch-plugin`, with `fleet:read`, `fleet:manage` and `crew:assign`) or gives it a new starting prompt, and hands its secret to the trierarch plugin server to server; no one sees the secret |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to listen on |

`npm run dev` builds `@aeolus-fleet/common` first: the console checks its forms with common's schemas and bundles the built package.

## Design system

The console is themed from `app/tokens.css`, the single copy of the design tokens (light on `:root`, dark on `.dark`, which follows the system setting). `app/globals.css` maps them onto Tailwind v4. The parts live in `components/` by atomic design level; atoms are shadcn/ui on Base UI (`components.json`). Geist and Geist Mono are self-hosted from `app/fonts/` under the SIL Open Font License.

`npm run storybook -w @aeolus-fleet/console` shows every part, with a story per meaningful state and a toolbar for light and dark. `npm run build-storybook -w @aeolus-fleet/console` builds it; CI does on every pull request.

Compose, in the Header (and the root TopBar on phone) of every page, sends a plain-text message as argo to one active ship by name or any ship of a type; each message keeps one idempotency key until it is sent.

The AccountMenu (the Sidebar's account button on desktop, the root TopBar's Avatar as a bottom sheet on phone) shows who is signed in and this session's device, the theme (Light, Dark, System), and Sign out. The theme is stored on the operator's account; the root layout asks the server for it with the session cookie when it renders, so the page never flashes the wrong theme, and the sign-in page follows the system.

Ship names and types are typed into the console's fields (commission, rename, the Compose recipient) in any case: uppercase becomes lowercase as it is typed, so HemmaFeature reads hemmafeature. The API stays strict and refuses uppercase.

The CommandPalette opens on Cmd+K (Ctrl+K) or the Header's search on desktop, and full screen from the root TopBar's search icon on phone: actions (Commission ship, Compose), the active ships by name or type, and the pages. Commission ship lands on the fleet overview with the CommissionDialog open (`/?commission=new`).

Crewed ships show when they were last seen ("Last seen 20 s ago") in the overview and on their page. A call writes no event, so an open page reads the snapshot again every 30 s, and relative times move on every 10 s.

Ping (in a fleet row and on the ship page, crewed agent ships only; disabled while a ship awaits crew) asks the ship's session to answer with pong. Under Last seen, the ship then shows "Pinged 3 min ago, no answer yet", "Answered ping in 4 s", or "Received, not answered with pong" after a plain ack. While a ping waits, Ping says so in a toast instead of sending another. An acknowledgement or an undeliverable delivery reloads the snapshot live, so the answer shows at once.
