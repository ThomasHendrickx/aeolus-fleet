# 0004 tRPC is the only API door

One tRPC router for every client. REST (generated, OpenAPI) and MCP (official SDK, streamable HTTP) map onto the ship procedures with no logic of their own, and onto the fleet actions a ship with fleet scopes may call (list, ship, commission, getStartingPrompt, release, recrew, retire, ping): REST at `/api/v1/fleet/<call>`, MCP tools `fleet_<call>`. The other fleet procedures and the console's stay on tRPC.

Why: Console and ships see identical behaviour; no back door.

Rejected: REST-first; a separate console backend.
