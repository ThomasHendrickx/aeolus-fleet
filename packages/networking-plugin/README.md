# @aeolus-fleet/networking-plugin

The first networking plugin (decision 0036): it holds the network rules argo edits, who may message whom, and supplies them to the fleet, which enforces them on every send (decisions 0034, 0035). Optional: a fleet without a networking plugin has no rules, all-to-all. Aeolus knows nothing about it beyond its ship, which holds `fleet:read` and `fleet:network` and reaches the fleet only through its public API.

It keeps per fleet the rules, the whole list or none for all-to-all, and what it declares for while it is unavailable: `block-all`, `open-all` or `keep-latest`, and after how many seconds without a call it is not responding (`keep-latest` after 300 until argo sets them). It supplies a fleet whole on every change and on reconnect: it registers as the fleet's networking plugin with that declaration, then sets the whole list. Switched off for a fleet, it unregisters, and the fleet is all-to-all; switched on again, it supplies the rules it kept. A supply the fleet refuses is tried again every `SUPPLY_RETRY_SECONDS`. Its ship receives while the process runs, which keeps its last seen fresh, and acknowledges every delivery on receipt, acting on none; a ping from argo gets pong.

## Running

1. Give it its own database and set its environment. No ship and no secret: the operator connects it.

| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | Its own Postgres database (`postgres://...`); it may share the Postgres server with the fleet and squadrons |
| `FLEET_URL` | yes | The fleet's public URL; it calls the ship API at `<FLEET_URL>/api/v1` and checks console sessions there. Not a secret; fixed here, so no caller can point it at another fleet |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4300` by default |
| `LOG_LEVEL` | no | `info` by default |
| `INSTALLATION_TOKEN` | no | The token a hosting service presents to its installation procedures, at least 32 characters (decision 0021). Unset: they do not exist and every fleet is served, as a self-hosted install needs |
| `SUPPLY_RETRY_SECONDS` | no | How often a supply the fleet refused is tried again. `10` by default |

2. `aeolus-networking-plugin start` migrates the database, supplies every fleet whose kept crew token its fleet still takes, serves, receives as its ship and retries refused supplies. Any other fleet is not connected. `aeolus-networking-plugin migrate` migrates alone.
3. Each fleet's operator connects it: commission its ship with `fleet:read` and `fleet:network`, and hand the ship's secret to `connection.connect`, server to server. It registers as a server and keeps only the crew token; the secret is never stored or logged. It registers as the fleet's networking plugin at once, with no rules. The console does this from Settings, and argo then edits the rules and the declaration on Network.

## API

One tRPC router at `/trpc`, called with the console's session cookie, which the fleet checks through `console.session`. Every procedure but the installation's works on the session's fleet.

| Procedure | What |
| --- | --- |
| `connection.status` | Whether it serves the fleet and is connected, as which ship, and the ship it was last connected as |
| `connection.connect` | Connects with its ship's id and secret (`fleet:manage` session). Refused while connected (CONFLICT), for a ship of another fleet or without the two scopes (BAD_REQUEST) |
| `network.get` | The rules (null for none) and the declaration, as argo edits them |
| `network.setRules` | Saves the whole list, or null for all-to-all, and supplies it at once; answers the rules and the supply: `supplied`, or `waiting` while the fleet does not answer. Over decision 0034's limits: BAD_REQUEST, nothing kept |
| `network.setDeclaration` | Saves `whileUnavailable` and `notRespondingAfterSeconds` (60 to 86400) and registers again with them at once; answers them and the supply |
| `installation.setEnabled`, `get`, `delete` | With `x-aeolus-installation-token`: switches a fleet on or off, reads it, forgets it (decision 0021). Delete unregisters from the fleet first; while the fleet does not answer it is refused (BAD_GATEWAY) and forgets nothing, so retry it with the same request id |

`network.*` are argo's only: a session without `fleet:network`, a viewer's, is refused (FORBIDDEN) before anything else. While it is off for the fleet, every procedure but `connection.status` answers FORBIDDEN; until it is connected, `network.*` answer PRECONDITION_FAILED.
