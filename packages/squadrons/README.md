# @aeolus-fleet/squadrons

Forms squadrons of ships from blueprints and leads them (decision 0017). Optional: a fleet works with individual ships only. Aeolus knows nothing about squadrons; squadrons is a ship of the fleet with `fleet:read` and `fleet:manage`, its management ship, and reaches the fleet only through its public API.

So far: its own process and database, the management ship, the catalogue of templates and blueprints from git (docs/squadrons.md), forming squadrons, `/api/health` and `/api/version`. The check-in arrives in the next slice of #86.

## Running

1. Commission the management ship in the console with both fleet scopes ("Fleet access": read and manage), and get its starting prompt.
2. Give squadrons its own database and set its environment:

| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | squadrons' own Postgres database (`postgres://...`); it may share the fleet's Postgres server |
| `FLEET_URL` | yes | The fleet's public URL; squadrons calls its ship API at `<FLEET_URL>/api/v1` |
| `MANAGEMENT_SHIP_ID` | yes | The management ship's id (`shp_...`) |
| `MANAGEMENT_SHIP_SECRET` | the first start | The secret from its starting prompt. squadrons registers once, keeps the crew token in its database and crews the ship again with it after a restart, so the secret is spent after the first start |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4100` by default |
| `LOG_LEVEL` | no | `info` by default |
| `SQUADRONS_CONFIG` | no | The file naming the repositories of templates and blueprints; `squadrons.yaml` by default. Without it squadrons runs with an empty catalogue |
| `SQUADRONS_CACHE_DIR` | no | Where the repositories' mirrors are kept; a folder under the system's temporary folder by default |

`squadrons.yaml` lists the repositories (docs/squadrons.md, "Configuration"): each with its `url`, an optional `name` (what blueprints reference; the URL without scheme and `.git` by default), an optional `path` (the folder of `templates/` and `blueprints/`; `squadrons` by default) and an optional `token`, the name of the environment variable holding a read token. `refresh` (default `5m`) is how often squadrons fetches them. squadrons runs `git`, so the host needs it.

3. `aeolus-squadrons start` migrates the database, crews the management ship and serves. `aeolus-squadrons migrate` migrates alone.

If another session holds the management ship (a lost crew token, say), the start says so: release the ship in the console, get a new starting prompt and set its secret.

## Paths

| Path | What |
| --- | --- |
| `/api/health` | Up and its database reachable: `{ "status": "ok" }`, or 503 |
| `/api/version` | `{ "squadrons": "<version>", "migration": "<latest migration>" }`. No authentication, no fleet data |
| `/trpc` | The squadrons API, for the web app's server. Every procedure needs the console session cookie of the fleet's signed-in operator, which squadrons checks with the fleet's `console.session`: `catalogue.list` (every tagged template and blueprint version, and every version left out with its problem), `catalogue.refresh` (fetch the repositories now), `squadrons.form` (`{ blueprint: { repository, name, version }, squadronId? }`: commissions the flagship, named as the squadron and crewed by squadrons, and the members; answers each member's crew line, with the squadron id, and its template's launch note, once) and `squadrons.list` (the fleet's squadrons, their state and members). A failure answers `Internal error` only; the log holds it whole |
