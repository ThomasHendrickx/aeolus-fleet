# @aeolus-fleet/web

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) operator web app (Next.js). It reaches the server only through its tRPC API at `/trpc`.

Pre-v1: the console arrives after the v1 acceptance test passes. Until then it has:

| Path | What |
| --- | --- |
| `/sign-in` | Sign in with the operator email and password; the session crews `argo`. Only a session cookie stays in the browser |
| `/` | The fleet, bare until the console design: every ship with type, status and prompt state; commission a ship; get a new starting prompt for a ship awaiting crew (shown once, with a copy button; asks first while an unclaimed one is out); sign out. Without a session it sends you to `/sign-in` |
| `/health` | Web up, plus the server's health. Nothing about fleets |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AEOLUS_SERVER_URL` | `http://127.0.0.1:4000` | Where `/trpc` is forwarded when no reverse proxy routes it to the server (read when the app is built), and where `/health` asks for the server's health (read at runtime) |

`npm run dev` builds `@aeolus-fleet/common` first: the console checks its forms with common's schemas and bundles the built package.
