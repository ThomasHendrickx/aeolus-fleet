# Compatibility with core

What a package of another release train (decision 0049) needs from core. Core keeps it, or the package raises its minimum core version in the same release.

## How a package checks core

- Core answers `GET /api/version` without authentication: `{ "server": "<core's version>", "common": "<common's version>" }` (architecture.md, `/api/version`).
- Each of squadrons, the trierarch plugin, the trierarch, the gateway and the watch plugin states the minimum core version it needs. At start, before it migrates, listens or registers, it reads `server` and compares it with that minimum as MAJOR.MINOR.PATCH.
- When core is older, the package exits 1 and logs one line that names its own version, the minimum and core's. It does the same when core does not answer or does not answer a version.
- Core `0.0.0` is a build from main, not a release, and counts as newer than any minimum.

## The ship contract

The ship contract is `/api/v1`, REST over the same procedures as `/trpc` and `/mcp` (decision 0004). Each package calls only the calls below, with a crew token. Its scopes are in its decision. The Aeolus Fleet plugin checks no version of its own: it is released with the trierarch, on one train.

| Package | Scopes | Calls under `/api/v1` |
| --- | --- | --- |
| squadrons | 0017 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `deregister`; `fleet/commission`, `ship`, `list`, `getStartingPrompt`, `crewRequest`, `removeCrewRequest`, `findLabelValue`, `release`, `retire`, `defineLabel`, `labels`, `assignLabel`, `unassignLabel`, `changeLabelValues`, `declareNetworkRules`, `declareScopes`, `scopes`. `fleet/approveCommission` and `withdrawCommissionApproval`, and `fleet/commission` with `approval: { approvalId, subjectDigest }` and `ownerOf`, need the core release carrying aeolus-fleet#1745 (recorded rights, decision 0046). `fleet/commission` with `ownerOf` alone checks the scopes to grant against the asking ship, refuses a retired one and records `scopesFrom` (core 0.32.4, design on-behalf-scopes) |
| trierarch plugin | 0030 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `deregister`; `fleet/commission`, `ship`, `list`, `assignCrew`, `explainCrewRequest`, `defineLabel`, `labels`, `assignLabel`, `unassignLabel`, `declareNetworkRules`, `declareScopes`, `scopes`, `limits` (core 0.33.1, the retention it prunes usage by). The requester of each crew request, `requestedBy` in `fleet/list` and `fleet/ship`, and its sends to every ship and every ship's sends to it with network rules applied, by the built-in rules `sendToPlugin` and `pluginSend` (decision 0034), need the core release carrying aeolus-fleet#1717. With the operator's console cookie and the Origin the console forwarded, `/trpc` `console.session`, `fleet.release` and `fleet.getStartingPrompt`, so the operator's own scopes and reach decide (decision 0057) |
| Aeolus Fleet plugin | those of the ship it crews | every `ship/` call, by name, and `openapi.json`; `ship/register` without a harness when it cannot tell it (core 0.34.1, aeolus-fleet#1408); `ship/ask`, `step` and `withdraw` need the core release carrying aeolus-fleet#1734 |
| trierarch | 0026 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `send`, `report`, `inbox`; `fleet/ship`, `getStartingPrompt`, `assignedCrewRequests`, `giveBackCrewRequest`, `reportCrewStatus`, `confirmCrewRelease`, `clearRequests`, `confirmWorktreeCleared`, `release` |
| gateway | 0044, 0056 | `ship/register`, `whoami`, `pushReceive`, `receiveReply`, `sentMessage`, `ack`, `delivery`, `handed`, `handled`, `notHandled`, `inbox`, `send`, `discover`, `setStatement`, `deregister`, `meeting`, `requestMic`, `withdrawMicRequest`, `releaseMic`; `fleet/commission`, `ship`, `getStartingPrompt`, `release`, `declareScopes`, `scopes`, `networkRules`, `checkManage` (core 0.32.0), `limits` (core 0.33.1, the retention a person reads: its days and where kept history begins). With argo's console cookie, `/trpc` `console.session` and `fleet.networkRules`. A person ship's exchange with one other ship, the list of its exchanges and seen up to here: `ship/exchange`, `exchanges`, `ackUpTo` (core 0.38.2, aeolus-fleet#1694, aeolus-fleet-gateway#302), and the reader's own delivery of each message it received in `exchange` (`receivedDelivery`, core 0.38.3, aeolus-fleet#1710), and the exchange's pruned edge, `prunedUpTo`, on every page (core 0.38.5, aeolus-fleet#1723, aeolus-fleet-gateway#333). `ship/sentMessage` answered as a page of the message's deliveries, `items` and `nextCursor` (aeolus-fleet#1834, aeolus-fleet-gateway#391), needs core 0.40.0, the gateway's minimum core. Presenting a person's account, `/trpc` `fleet.harbour` returns its five states, awaiting crew and blocked apart (aeolus-fleet-gateway#231) |
| watch plugin | 0071 | `ship/register`, `whoami`, `receive`, `ack`, `pong`, `deregister`; `fleet/ship`. `GET ship/wakeups`, read as server-sent events, its open wake, later wakes and its `LEASE_ENDED` end telling it when to receive (decision 0072), needs core 0.39.0, the watch plugin's minimum core |

A crew settings workspace of `{ kind: repositories, main: { repository, ref? }, subRepositories: [{ repository, ref? }] }` (decision 0027) needs the core release carrying aeolus-fleet#1760; from it on, core refuses the `{ kind: worktree }` workspace it replaces and holds every stored request in the new shape, so squadrons, the trierarch plugin and the trierarch read and write only the new one.

A payload or a statement over 64 KB, up to 256 KB (decision 0006), needs the core release carrying aeolus-fleet#1418; an older core refuses it.

Every package also builds against `@aeolus-fleet/common`: its schemas are the shapes of these calls, of plugin details per ship type (decision 0028) and of crew settings (decision 0027).

## Authenticated plugin calls

`fleet.callPlugin`, REST `POST /api/v1/fleet/callPlugin` and MCP `fleet_callPlugin`, together with the context/answer schemas and `@aeolus-fleet/common/plugin-server`, need core/common 0.42.0. A plugin raises its minimum to 0.42.0 before using this call. Deployment and the durable reservation port are in [Serving authenticated plugin calls](plugin-calls.md); authority and refusal semantics are in the [approved contract](design/plugin-actor-contract.md). Repository operations remain the trierarch plugin's API, not core's.

## What the console needs from the trierarch plugin

The console calls the trierarch plugin's tRPC procedures from the web app's server with the operator's console session (decision 0033). It needs trierarch plugin 0.33.0 or later, which serves the fleet's enabled models (`models.list`, `models.enable` and `models.disable`, decision 0063) and a machine's new setup line (`machines.newSetupLine`, #1239), to which it forwards the request's Origin.

## Hosting service journey reads

`installation.fleets.get` with optional `journey`, and `installation.fleets.page` and `installation.fleets.changes`, need core/common 0.42.0. Missing `journey` means unavailable. The hosting service validates the contract before reconciling; it never interprets an absent field as zero. See [Installation](architecture.md#installation) for cursors and [fleet journey milestones](blueprint.md#fleet-journey-milestones) for definitions and coverage.

## One reachable ship

`ship.lookup`, REST `POST /api/v1/ship/lookup` and MCP `lookup`, need the core/common release carrying aeolus-fleet#1911. Consumers raise their minimum to that release before calling it. It takes exactly one name or id and by default answers `{ id, name, description }` or null, with `messages:send` and current send reach. The gateway calls as the person's ship for conversation headers (gateway #390). See the [ship contract](guide/ship-contract.md) for visibility and description semantics.

## Compact discovery and statement lookup

The core/common release carrying aeolus-fleet#1957 directly changes `ship.discover` (REST `discover`, MCP `discover`) to return crew summaries with source/version, without capabilities. Identity, status, verified facts and type counts remain. `ship.lookup` accepts `includeStatement: true` to add the complete current `statement`, with its source/version or commission-note/null fallback, under the same `messages:send` scope and current send reach. Without the option its header stays unchanged. An unreachable or missing target answers null.

Consumers needing capability schemas must discover summaries, then look up the chosen ship with `includeStatement: true`. Raise their minimum core/common version to the release carrying #1957. Gateway MCP tools and A2A cards that consume full discover statements need the [gateway #424](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/424) before adopting that release.
