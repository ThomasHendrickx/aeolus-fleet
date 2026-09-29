# 0004 tRPC is the only API door

One tRPC router for every client. REST (generated, OpenAPI) and MCP (official SDK, streamable HTTP) map onto the ship procedures with no logic of their own.

Why: Console and ships see identical behaviour; no back door.

Rejected: REST-first; a separate console backend.
