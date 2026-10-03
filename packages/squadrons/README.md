# @aeolus-fleet/squadrons

Forms squadrons of ships from blueprints and leads them (decision 0017). Optional: a fleet works with individual ships only. Aeolus knows nothing about squadrons; squadrons is a ship of the fleet with `fleet:read` and `fleet:manage`, its management ship, and reaches the fleet only through its public API.

So far: its own process and database, the connection the operator makes in the console as its management ship, the catalogue of templates and blueprints from git (docs/squadrons.md), forming squadrons, the check-in at each flagship (docs/squadrons.md, "Check-in"), `/api/health` and `/api/version`.

squadrons receives on every forming or sailing squadron's flagship. A member's check-in is kept with the model it states and answered with its role (template, charter, check-in interval, hand-offs as selectors); its on-station marks it, and the squadron sails once every member is on station. A flagship supports only the squadron's messages: any other message, from outside or from a member, is acknowledged and kept (`squadrons.messages`), never forwarded, and argo is told in its inbox, so no message disappears or goes unseen. The flagship acks each delivery only after handling it, and handling one that comes again (after a crash or a failed ack) gives the same answer and changes nothing twice. When a flagship is released, squadrons stops receiving on it and tells argo.

## Running

1. Give squadrons its own database and set its environment. No management ship and no secret: the operator connects squadrons in the console.


| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | squadrons' own Postgres database (`postgres://...`); it may share the fleet's Postgres server |
| `FLEET_URL` | yes | The fleet's public URL; squadrons calls its ship API at `<FLEET_URL>/api/v1` and checks console sessions there. Not a secret; fixed here, so no caller can point squadrons at another fleet |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4100` by default |
| `LOG_LEVEL` | no | `info` by default |
| `SQUADRONS_CONFIG` | no | The file naming the repositories of templates and blueprints; `squadrons.yaml` by default. Without it squadrons runs with an empty catalogue |
| `SQUADRONS_CACHE_DIR` | no | Where the repositories' mirrors are kept; a folder under the system's temporary folder by default |

`squadrons.yaml` lists the repositories (docs/squadrons.md, "Configuration"): each with its `url`, an optional `name` (what blueprints reference; the URL without scheme and `.git` by default), an optional `path` (the folder of `templates/` and `blueprints/`; `squadrons` by default) and an optional `token`, the name of the environment variable holding a read token. `refresh` (default `5m`) is how often squadrons fetches them. squadrons runs `git`, so the host needs it.

2. `aeolus-squadrons start` takes the process lock, migrates the database and serves. With a crew token kept from an earlier connection that the fleet still takes, it is connected again and retires every ship a forming cut short by a crash had commissioned; otherwise it serves not connected. `aeolus-squadrons migrate` migrates alone.
3. Connect it in the console: Settings, Connect squadrons. The web app's server commissions the management ship (`squadrons`, with `fleet:read` and `fleet:manage`) and hands its secret to squadrons' `connection.connect`, server to server; squadrons registers as a server and keeps only the crew token. The secret is never shown or stored.

Until it is connected, `catalogue.*` and `squadrons.*` answer PRECONDITION_FAILED. When the operator releases the management ship, squadrons drops its crew token and is not connected again: Connect squadrons, the same button, issues a new starting prompt for the same ship.

One squadrons process runs per database: a second start on the same database refuses and says so, so stop the old process before starting a new one (a rolling deploy cannot overlap them). A process whose lock connection fails stops.

## Paths

| Path | What |
| --- | --- |
| `/api/health` | Up and its database reachable: `{ "status": "ok", "connection": "connected" \| "not-connected" }`, or 503 |
| `/api/version` | `{ "squadrons": "<version>", "migration": "<latest migration>", "connection": "connected" \| "not-connected" }`. No authentication, no fleet data |
| `/trpc` | The squadrons API, for the web app's server. Every procedure needs the console session cookie of the fleet's signed-in operator, which squadrons checks with the fleet's `console.session` (once connected, only the operator of that fleet): `connection.status` (whether it is connected, as which ship, and the ship it was last connected as), `connection.connect` (`{ shipId, secret }`: registers as that ship and keeps its crew token; refused while connected, for a wrong secret, for a ship of another fleet or without `fleet:read` and `fleet:manage`), `catalogue.list` (every tagged template and blueprint version, and every version left out with its problem), `catalogue.refresh` (fetch the repositories now), `squadrons.messages` (`{ squadronId }`: the messages its flagship kept), `squadrons.form` (`{ blueprint: { repository, name, version }, squadronId? }`: commissions the flagship, named as the squadron and crewed by squadrons, and the members, each under an idempotency key of its formation attempt, so a lost answer is asked again without a second ship and the ship gets a new starting prompt; answers each member's crew line, with the squadron id, and its template's launch note and pinned model, once) and `squadrons.list` (the fleet's squadrons, their state and members, each member with the model its template pins, the model it stated at check-in and whether they differ). A failure answers `Internal error` only; the log holds it whole |
