# @aeolus-fleet/server

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) server: one tRPC API and the fleet domain on Postgres, with its migrations.

Pre-v1: the API changes without notice until the v1 acceptance test passes.

## Running from npm

```sh
npm install @aeolus-fleet/server @aeolus-fleet/web
export DATABASE_URL=postgresql://... PUBLIC_URL=https://fleet.example.com
npx aeolus-server migrate
npx aeolus-server fleet:init --name "my fleet"   # once: asks for the operator email and password
npx aeolus-server start
```

| Command | Does |
| --- | --- |
| `aeolus-server start` | Migrates the database, then serves the fleet until `SIGINT` or `SIGTERM` |
| `aeolus-server migrate` | Applies the migrations the package ships, with Prisma Migrate, and nothing else. Needs `DATABASE_URL` alone |
| `aeolus-server fleet:init --name "<fleet name>"` | See Server commands below |
| `aeolus-server operator:reset-password` | See Server commands below |

Prisma Migrate holds a Postgres advisory lock while it migrates, so two processes starting at once never migrate at once: the second waits, then finds nothing left to apply. It never asks Prisma's servers for a newer version.

On `SIGINT` or `SIGTERM` the server stops taking requests, and every receive waiting on an empty inbox answers with no deliveries at once. Idle connections close at once, and a connection whose request ends during the stop closes with its answer, so nothing holds the stop up.

## Configuration

Environment variables, validated at startup (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres 16 or newer, with a direct connection |
| `PUBLIC_URL` | required | Where ships reach the fleet (`http://` or `https://`): every starting prompt carries the fleet MCP URL under it, `<PUBLIC_URL>/mcp` |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `PORT` | `4000` | Port to listen on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy, so the sign-in and failed-register rate limits count per client address from `X-Forwarded-For`; without it every client behind the proxy shares one budget |
| `COOKIE_DOMAIN` | unset | The domain the console session cookie is set for, such as `fleet.example.com`, so a console on another host under it receives the cookie. Every host under it does, so pick the narrowest domain the console and the server share. Unset: the server's host only |
| `CONSOLE_ORIGIN` | `PUBLIC_URL`'s origin | The console's origin, such as `https://console.fleet.example.com`: the only origin a state-changing console call (sign-in, sign-out, a change made with the session cookie) is taken from, and the one origin allowed to call with credentials from another host (CORS). The default fits web and server behind one host. In development the console runs on `http://localhost:3000` (see `.env.example`) |

The browser calls the server's `/trpc` itself, at the address the web app runs with (`AEOLUS_SERVER_URL`, see the web README), so the console may run on another host: set `COOKIE_DOMAIN` and `CONSOLE_ORIGIN` for it. The console follows the fleet live through the `fleet.events` subscription, over a WebSocket opened on the same `/trpc` path, so a proxy in front must pass the upgrade on (Caddy does by itself). The upgrade carries the session cookie and is refused from any origin but `CONSOLE_ORIGIN`, as a state-changing call is. A console call refused because the operator signed in somewhere else carries `refusal: "SIGNED_IN_ELSEWHERE"` in its error data, and a rate-limited sign-in carries `retryAt`, when the client may try again.

## Server commands

Run on the server, against the configured database, once it is migrated:

| Command | Does |
| --- | --- |
| `aeolus-server fleet:init --name "<fleet name>"` | Asks for the operator email and password (twice, not shown), then creates the fleet, its operator ship `argo` and the operator account. Refuses when a fleet already exists |
| `aeolus-server operator:reset-password` | Asks for a new operator password (twice, not shown) and sets it. The old one stops working and every console session ends |

Both commands read their answers a line at a time from standard input, so a script can pipe them in. Like the API, they refuse any answer holding the character U+0000, naming what holds it, and change nothing. In this repository they run as `npm run fleet:init -w @aeolus-fleet/server -- --name "<fleet name>"` and `npm run operator:reset-password -w @aeolus-fleet/server`, and `npm run db:migrate -w @aeolus-fleet/server` migrates.

The operator signs in to the console with that email and password; the session crews `argo`, which has no secret. The password is stored as an Argon2id hash. The console keeps only a session cookie (httpOnly, Secure, SameSite=Strict), valid 30 days after its last use. A wrong email and a wrong password get the same answer.

## Ships

The operator gets a ship's starting prompt from `fleet.commission`, or later from `fleet.getStartingPrompt`. It carries identity only: the fleet MCP URL (`<PUBLIC_URL>/mcp`) and the one-line command that adds it to Claude Code, the ship id and secret, how to pick the location, and `Call register.` What the ship works on, the operator adds after it.

A session crews an agent ship with `ship.register`: the ship id and secret from its starting prompt, and where it runs (`DEVICE`, `CLOUD`, `SERVER`, or `OTHER` with a description). It gets a crew token (`aeolus_ct_v1_...`) back once, and every later call carries it as `Authorization: Bearer <crew token>`; the secret works only for `register`. A second `register` fails while a session crews the ship. Failed `register` attempts (a wrong ship id or secret) are rate-limited per client address; a successful claim never counts, so one address can start many sessions. `ship.whoami` answers the caller's ship: id, fleet, name and type.

`ship.send` sends a message from the calling ship (a crew token, or the console session as `argo`); it needs the `messages:send` scope. It takes a selector (`{ "kind": "ship", "shipId": "shp_..." }`, `{ "kind": "ship", "name": "scout" }` or `{ "kind": "type", "type": "reviewer" }`), a payload (text of at most 64 KB in UTF-8, never parsed), optionally its content type (any well-formed media type, such as `text/plain` or `application/json; charset=utf-8`, passed on untouched; `text/plain` when left out), the sender's own idempotency key (1 to 256 characters) and, for a reply, `inReplyTo` (a message id of the fleet). A name is resolved to the ship's id when the message is sent; a retired or unknown ship, or a type without an active ship, is refused. It answers `{ "messageId": "msg_..." }` only once the message and its delivery are stored. A repeat of the key with the same request (selector as sent, payload, content type, `inReplyTo`; no content type is the same as `text/plain`) answers with the original id; the same key with another request is refused (`CONFLICT`). When the send commits, Postgres `NOTIFY` announces the delivery on the channel `aeolus_delivery_pending`.

`ship.receive` and `ship.ack` take the crew token only (the console session is refused) and need the `messages:receive` scope. `ship.receive` takes `{ "max": 1 to 10 }`, one when left out, and answers `{ "deliveries": [...] }`: the crew's own unacknowledged deliveries in flight first, then the oldest pending ones for its ship or its type. Each comes with its message and its sender (`deliveryId`, `messageId`, `senderShipId`, `senderName`, `senderType`, `recipient`, `payload`, `contentType`, `inReplyTo`, `sentAt`, `attempts`; the sender's name and type as they are at the receive, so a renamed sender goes by its new name) and stays in flight until acknowledged or the lease ends; the crew's next receive returns it again, counted as another claim, so a lost reply loses nothing. The fifth claim of a delivery never acknowledged makes it undeliverable instead. With nothing there, a receive waits about 25 seconds and answers with no deliveries; a delivery for its ship or type wakes it at once. `ship.ack` takes `{ "deliveryId": "dlv_..." }` and answers `{}`: only the ship holding the delivery in flight acknowledges it, and acknowledging it again is OK.

A lease ends cleanly in two ways. The operator releases a crewed ship with `fleet.release` (`{ "shipId": "shp_..." }`, scope `fleet:manage`); `argo` is never released, and a ship awaiting crew gets a new starting prompt instead (`CONFLICT`). A crew ends its own lease with `ship.deregister`, which takes the crew token only and no scope. Both work in one transaction: the secret is invalidated, the lease and its crew token end, and the deliveries the lease held in flight return to pending, to the ship's inbox or its type's queue, their attempts kept, each announced on `aeolus_delivery_pending` as a send is, so a waiting receive of another ship of the type takes a returned type delivery at once. Both answer `{}`. The old crew token then fails on every call, refused as `LEASE_ENDED` with `This ship was released; this session no longer crews it.` (the `UNAUTHORIZED` code at `/trpc`, which knows only tRPC's codes), and the old secret fails on `register`; the next crew needs a new starting prompt. A receive of that crew still waiting hands out nothing: it answers empty at the end of its wait, or `LEASE_ENDED` if a delivery wakes it first.

A ship reaches the same calls without installing anything, as REST under `/api/v1` or as MCP tools at `/mcp`. Both map onto the ship procedures above and hold no logic of their own; neither reads the console session cookie, so a call without a valid crew token is told to use the crew token alone, and failed `register` attempts count against one limit per client address whichever door they come through. A failure in either door, inside a procedure or not, answers only `Internal error` and the request's id. The MCP server sends the ship protocol (`adapters/trpc/ship-protocol.ts`) as its instructions when a client connects, and the OpenAPI spec's description opens with the same text: register once, at the start, and keep the crew token; then receive, ack each delivery and act only if the ack succeeded, and answer by `senderName` with `inReplyTo`; keep receiving while waiting for an answer; deregister only when the session ends for good; end the turn when the work is done and no answer is expected; and once a call answers `LEASE_ENDED`, stop calling the fleet. Each call's description states only that call's own rules, such as `inReplyTo` taking the message id and a new idempotency key for every message; no rule is stated in both.

- **REST**: `POST /api/v1/ship/register`, `GET /api/v1/ship/whoami`, and `POST /api/v1/ship/send`, `/receive`, `/ack` and `/deregister`, each with a JSON body where it takes input and the crew token as `Authorization: Bearer`. A refusal answers with its code's HTTP status and `{ "code": "CONFLICT", "message": "..." }`. The OpenAPI 3.1 spec is at `/api/v1/openapi.json`, and as a readable page at `/api/v1/docs`.
- **MCP**: a remote MCP server over streamable HTTP, one tool per call. The connection carries no ship, so many conversations can share it (ADR 0015): every tool but `register` takes the crew token as its `crewToken` argument. A refusal is a tool error reading `CODE: message`. To add it to Claude Code, for every session on the machine: `claude mcp add --transport http --scope user aeolus <PUBLIC_URL>/mcp`.

The server listens on `aeolus_delivery_pending` over a connection of its own (named `aeolus-delivery-listener` in Postgres), which needs a direct database connection, not a transaction pooler. After a lost connection it listens again, with a delay that doubles up to 30 seconds, and every waiting receive then looks again, since notices sent meanwhile are gone.

No text input to any procedure may hold the character U+0000, which Postgres cannot store: it is refused as `BAD_REQUEST`, naming the field. A refusal answers its own code and message. A server failure answers only `Internal error` and the request's id (`data.requestId`); the server log holds the whole error, stack included, under the same id (`reqId`). No answer ever carries a stack trace.

A database error is logged by its codes only, under `database`: Prisma's code, Postgres's SQLSTATE and the driver adapter's kind, never its message or stack, since Postgres quotes values from the request in its words. The same holds for the health check, the delivery listener and the server commands.

A request Fastify refuses before any procedure runs answers in the same `{ "code", "message" }` shape: a body that is not JSON `400 BAD_REQUEST`, a body over 1 MiB `413 PAYLOAD_TOO_LARGE`, a body of another content type `415 UNSUPPORTED_MEDIA_TYPE`, and a path or method nothing serves `404 NOT_FOUND`.
