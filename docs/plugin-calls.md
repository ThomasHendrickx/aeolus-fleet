# Serving authenticated plugin calls

Core 0.41.0 exposes `fleet.callPlugin`, `POST /api/v1/fleet/callPlugin` and MCP `fleet_callPlugin`. The [approved actor contract](design/plugin-actor-contract.md) defines admission, scope, reach and failure semantics.

## Deployment

Set core's `PLUGIN_TARGETS` to a JSON array of `{ fleetId, pluginShipId, url, secret }`. `url` is the plugin's complete internal context endpoint. Each fleet/plugin pair occurs once. Secrets contain at least 32 characters. Keep this environment setting in server secret configuration, outside fleet data, browser configuration and agent sessions.

HTTPS endpoints are accepted. Plain HTTP endpoints use a loopback or private IPv4 literal, or localhost. Use HTTPS for other hostnames. Redirects are refused. Core sends the secret in `Aeolus-Plugin-Secret`, never in the body. An unset setting exposes no target endpoints.

## Plugin boundary

Import `createPluginBoundary` from `@aeolus-fleet/common/plugin-server`. Mount it on the plugin's separate internal context listener. The listener supplies `body`, the secret header and trusted `isInternal`/`isPublic` metadata. Derive those booleans from listener/network configuration, never from the body, a query parameter or a forwarded header. Keep the listener inaccessible from the public network. Public cookie procedures reject this header and never use context authentication.

Configure the plugin ship id, current/next secrets, clock, fleet-serving lookup, explicitly exposed procedure map and `PluginDispatchReservations`. The reservation adapter must atomically reserve `(fleetId, pluginShipId, requestId)` in durable storage before execution, retaining it through `expiresAt`. Concurrent or changed reuse returns conflict. A restart must retain live reservations; after the deadline the context itself is refused even if reservations have been pruned.

Each exposed operation validates its own arguments and effective scopes and stores its change, actor event and delivery work in its own transaction. The verified context supplies the event actor and fleet. No installation or public-cookie procedure is exposed implicitly. The boundary answers the shared `pluginCallAnswerSchema`; internal failures carry no raw diagnostics.

Rotate by accepting both secrets in the plugin, switching core's configured secret, then removing the old plugin secret. Restart each server when applying its deployment settings.

Core dispatches once. An uncertain answer includes the dispatch request id and asks the caller to read current state before a new call. Dispatch logs contain request id, target, procedure, duration and outcome, excluding inputs, scopes and secrets.
