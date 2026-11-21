# 0004 tRPC is the only API door

One tRPC router for every client. REST (generated, OpenAPI) and MCP (official SDK, streamable HTTP) map onto the ship procedures with no logic of their own, and onto the fleet actions a ship with fleet scopes may call (`FLEET_ACTIONS` in `core/src/adapters/trpc/ship-contract.ts` is the one list): REST at `/api/v1/fleet/<call>`, MCP tools `fleet_<call>`. The other fleet procedures and the console's stay on tRPC.

Named idempotency refusals follow the [ship contract](../guide/ship-contract.md#idempotency-keys) at every door.

Why: Console and ships see identical behaviour; no back door.

Rejected: REST-first; a separate console backend.
