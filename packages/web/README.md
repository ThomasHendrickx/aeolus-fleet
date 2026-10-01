# @aeolus-fleet/web

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) operator web app (Next.js). It reaches the server only through its tRPC API at `/trpc`.

Pre-v1: the console arrives after the v1 acceptance test passes. Until then it has:

| Path | What |
| --- | --- |
| `/sign-in` | Sign in with the operator email and password; the session crews `argo`. Only a session cookie stays in the browser |
| `/` | The fleet overview, live over a WebSocket: every ship with status, type, and where a crewed ship's session runs or an awaiting ship's prompt status, updated without a reload; search and filters in the URL; commission a ship; get a new starting prompt for a ship awaiting crew (shown once, with a copy button; asks first while an unclaimed one is out); release a crewed ship other than `argo`, after a confirm; sign out from the account menu. Without a session it sends you to `/sign-in`, which says so when you signed in somewhere else |
| `/health` | Web up, plus the server's health. Nothing about fleets |

## Running from npm

The package holds the console already built. It knows no server address until it runs:

```sh
npm install @aeolus-fleet/web
AEOLUS_SERVER_URL=https://fleet.example.com PORT=3000 npx aeolus-web start
```

`aeolus-web start` serves it with `next start`, without Next.js telemetry, until `SIGINT` or `SIGTERM`.

## Configuration

Environment variables, read when the app runs, never when it is built:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AEOLUS_SERVER_URL` | `http://localhost:4000` | The Aeolus server. The browser calls its `/trpc` there, with credentials, and follows the fleet over a WebSocket to the same path (`ws://` or `wss://`), and the web app's `/health` asks its `/health`, so both must reach it. Behind one host with the server, it is the server's public URL. On another host, the server needs `COOKIE_DOMAIN` and `CONSOLE_ORIGIN` for the console (see the server README) |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to listen on |

`npm run dev` builds `@aeolus-fleet/common` first: the console checks its forms with common's schemas and bundles the built package.

## Design system

The console is themed from `app/tokens.css`, the single copy of the design tokens (light on `:root`, dark on `.dark`, which follows the system setting). `app/globals.css` maps them onto Tailwind v4. The parts live in `components/` by atomic design level; atoms are shadcn/ui on Base UI (`components.json`). Geist and Geist Mono are self-hosted from `app/fonts/` under the SIL Open Font License.

`npm run storybook -w @aeolus-fleet/web` shows every part, with a story per meaningful state and a toolbar for light and dark. `npm run build-storybook -w @aeolus-fleet/web` builds it; CI does on every pull request.
