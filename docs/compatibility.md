# Compatibility with core

What a package of another release train (decision 0049) needs from core. Core keeps it, or the package raises its minimum core version in the same release.

## How a package checks core

- Core answers `GET /api/version` without authentication: `{ "server": "<core's version>", "common": "<common's version>" }` (architecture.md, `/api/version`).
- Each of squadrons, the trierarch plugin, the trierarch and the gateway states the minimum core version it needs. At start, before it migrates, listens or registers, it reads `server` and compares it with that minimum as MAJOR.MINOR.PATCH.
- When core is older, the package exits 1 and logs one line that names its own version, the minimum and core's. It does the same when core does not answer or does not answer a version.
- Core `0.0.0` is a build from main, not a release, and counts as newer than any minimum.

## The ship contract

The ship contract is `/api/v1`, REST over the same procedures as `/trpc` and `/mcp` (decision 0004). Each package calls only the calls below, with a crew token. Its scopes are in its decision. The Aeolus Fleet plugin checks no version of its own: it is released with the trierarch, on one train.

| Package | Scopes | Calls under `/api/v1` |
| --- | --- | --- |
| squadrons | 0017 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `deregister`; `fleet/commission`, `ship`, `list`, `getStartingPrompt`, `crewRequest`, `removeCrewRequest`, `findLabelValue`, `release`, `retire`, `defineLabel`, `labels`, `assignLabel`, `unassignLabel`, `changeLabelValues`, `declareNetworkRules`, `declareScopes`, `scopes`. `fleet/commission` with `ownerOf` checks the scopes to grant against the asking ship, refuses a retired one and records `scopesFrom` (core 0.32.4, design on-behalf-scopes) |
| trierarch plugin | 0030 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `deregister`; `fleet/commission`, `ship`, `list`, `assignCrew`, `explainCrewRequest`, `defineLabel`, `labels`, `assignLabel`, `unassignLabel`, `declareNetworkRules`, `declareScopes`, `scopes`, `limits` (core 0.33.1, the retention it prunes usage by). With the operator's console cookie and the Origin the console forwarded, `/trpc` `console.session`, `fleet.release` and `fleet.getStartingPrompt`, so the operator's own scopes and reach decide (decision 0057) |
| Aeolus Fleet plugin | those of the ship it crews | every `ship/` call, by name, and `openapi.json`; `ship/register` without a harness when it cannot tell it (core 0.34.1, aeolus-fleet#1408) |
| trierarch | 0026 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `report`, `inbox`; `fleet/ship`, `getStartingPrompt`, `assignedCrewRequests`, `giveBackCrewRequest`, `reportCrewStatus`, `confirmCrewRelease`, `clearRequests`, `confirmWorktreeCleared`, `release` |
| gateway | 0044, 0056 | `ship/register`, `whoami`, `pushReceive`, `receiveReply`, `sentMessage`, `ack`, `delivery`, `handed`, `handled`, `notHandled`, `inbox`, `send`, `discover`, `setStatement`, `deregister`, `meeting`, `requestMic`, `withdrawMicRequest`, `releaseMic`; `fleet/commission`, `ship`, `getStartingPrompt`, `release`, `declareScopes`, `scopes`, `networkRules`, `checkManage` (core 0.32.0). With argo's console cookie, `/trpc` `console.session` and `fleet.networkRules` |

A payload or a statement over 64 KB, up to 256 KB (decision 0006), needs core 0.34.1; an older core refuses it.

Every package also builds against `@aeolus-fleet/common`: its schemas are the shapes of these calls, of plugin details per ship type (decision 0028) and of crew settings (decision 0027).

## What the console needs from the trierarch plugin

The console calls the trierarch plugin's tRPC procedures from the web app's server with the operator's console session (decision 0033). It needs trierarch plugin 0.33.0 or later, which serves the fleet's enabled models (`models.list`, `models.enable` and `models.disable`, decision 0063) and a machine's new setup line (`machines.newSetupLine`, #1239), to which it forwards the request's Origin.
