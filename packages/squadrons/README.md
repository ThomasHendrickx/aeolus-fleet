# @aeolus-fleet/squadrons

Forms squadrons of ships from blueprints and leads them (decision 0017). Optional: a fleet works with individual ships only. Aeolus knows nothing about squadrons; squadrons is a ship of the fleet with `fleet:read` and `fleet:manage`, its management ship, and reaches the fleet only through its public API.

This package holds the skeleton so far: its own process and database, the management ship, `/api/health` and `/api/version`. Squadrons themselves arrive in the next slices of #86.

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

3. `aeolus-squadrons start` migrates the database, crews the management ship and serves. `aeolus-squadrons migrate` migrates alone.

If another session holds the management ship (a lost crew token, say), the start says so: release the ship in the console, get a new starting prompt and set its secret.

## Paths

| Path | What |
| --- | --- |
| `/api/health` | Up and its database reachable: `{ "status": "ok" }`, or 503 |
| `/api/version` | `{ "squadrons": "<version>", "migration": "<latest migration>" }`. No authentication, no fleet data |
