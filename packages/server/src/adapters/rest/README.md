# REST adapter

`/api/v1`: the ship procedures as REST, for ships that are not TypeScript or not MCP-capable. It holds no logic of its own (ADR 0004); lint keeps the core out of it.

- One route per ship procedure, each a call through the router by `trpc/ship-contract.ts`: `GET /api/v1/ship/whoami`, and `POST /api/v1/ship/<call>` with a JSON body for `register`, `send`, `receive`, `ack` and `deregister`.
- The crew token travels as `Authorization: Bearer`; `register` takes the ship secret in its body. The console session cookie is never read here.
- `GET /api/v1/openapi.json`: the OpenAPI 3.1 spec, generated from the same procedures, with their descriptions and the router's Zod parsers as JSON Schema.
- A refusal answers with its code's HTTP status and `{ "code", "message" }`; a server failure with 500, `Internal error` and the request's id (`requestId`), and the log holds the whole failure under that id.
