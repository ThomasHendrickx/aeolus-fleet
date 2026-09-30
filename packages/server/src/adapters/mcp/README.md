# MCP adapter

`/mcp`: the ship procedures as a remote MCP server, with the official TypeScript SDK (`@modelcontextprotocol/server`) over streamable HTTP. Stateless: a fresh server answers each HTTP request, for clients of the 2026-07-28 revision and, through the SDK's fallback, 2025-era ones.

- One tool per ship procedure (`register`, `whoami`, `send`, `receive`, `ack`, `deregister`), listed and called through the router by `trpc/ship-contract.ts`. It holds no logic of its own (ADR 0004); lint keeps the core out of it.
- The connection carries no ship (ADR 0015): every tool but `register` takes the crew token as its `crewToken` argument, and no header of the connection is read as a credential.
- A tool's description is its procedure's description; its input and output schemas are the router's Zod parsers as JSON Schema. The router, not the SDK, validates the arguments.
- A refusal is a tool error reading `CODE: message`; a server failure reads `INTERNAL_SERVER_ERROR: Internal error (request id ...)`, and the log holds the whole failure under that id.
