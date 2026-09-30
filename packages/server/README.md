# @aeolus-fleet/server

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) server: one tRPC API and the fleet domain on Postgres, with its migrations.

Pre-v1: the API changes without notice until the v1 acceptance test passes.

## Configuration

Environment variables, validated at startup (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres 16 or newer, with a direct connection |
| `PUBLIC_URL` | required | Where ships reach the fleet (`http://` or `https://`): the fleet URL every starting prompt carries |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `PORT` | `4000` | Port to listen on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy, so the sign-in and failed-register rate limits count per client address from `X-Forwarded-For`; without it every client behind the proxy shares one budget |
| `COOKIE_DOMAIN` | unset | The domain the console session cookie is set for, such as `fleet.example.com`, so a console on another host under it receives the cookie. Every host under it does, so pick the narrowest domain the console and the server share. Unset: the server's host only |
| `CONSOLE_ORIGIN` | `PUBLIC_URL`'s origin | The console's origin, such as `https://console.fleet.example.com`: the only origin a state-changing console call (sign-in, sign-out, a change made with the session cookie) is taken from, and the one origin allowed to call with credentials from another host (CORS). The default fits web and server behind one host. In development the console runs on `http://localhost:3000` (see `.env.example`) |

The web app still calls `/trpc` on its own origin, so running it on another host than the server also needs a web change that is not built yet.

## Server commands

Run on the server, against the configured database, after `npm run db:migrate`:

| Command | Does |
| --- | --- |
| `npm run fleet:init -w @aeolus-fleet/server -- --name "<fleet name>"` | Asks for the operator email and password (twice, not shown), then creates the fleet, its operator ship `argo` and the operator account. Refuses when a fleet already exists |
| `npm run operator:reset-password -w @aeolus-fleet/server` | Asks for a new operator password (twice, not shown) and sets it. The old one stops working and every console session ends |

Both commands read their answers a line at a time from standard input, so a script can pipe them in.

The operator signs in to the console with that email and password; the session crews `argo`, which has no secret. The password is stored as an Argon2id hash. The console keeps only a session cookie (httpOnly, Secure, SameSite=Strict), valid 30 days after its last use. A wrong email and a wrong password get the same answer.

## Ships

A session crews an agent ship with `ship.register`: the ship id and secret from its starting prompt, and where it runs (`DEVICE`, `CLOUD`, `SERVER`, or `OTHER` with a description). It gets a crew token (`aeolus_ct_v1_...`) back once, and every later call carries it as `Authorization: Bearer <crew token>`; the secret works only for `register`. A second `register` fails while a session crews the ship. Failed `register` attempts (a wrong ship id or secret) are rate-limited per client address; a successful claim never counts, so one address can start many sessions. `ship.whoami` answers the caller's ship: id, fleet, name and type.

`ship.send` sends a message from the calling ship (a crew token, or the console session as `argo`); it needs the `messages:send` scope. It takes a selector (`{ "kind": "ship", "shipId": "shp_..." }`, `{ "kind": "ship", "name": "scout" }` or `{ "kind": "type", "type": "reviewer" }`), a payload (text of at most 64 KB in UTF-8, never parsed), its content type (any well-formed media type, such as `text/plain` or `application/json; charset=utf-8`, passed on untouched), the sender's own idempotency key (1 to 256 characters) and, for a reply, `inReplyTo` (a message id of the fleet). A name is resolved to the ship's id when the message is sent; a retired or unknown ship, or a type without an active ship, is refused. It answers `{ "messageId": "msg_..." }` only once the message and its delivery are stored. A repeat of the key with the same request (selector as sent, payload, content type, `inReplyTo`) answers with the original id; the same key with another request is refused (`CONFLICT`). When the send commits, Postgres `NOTIFY` announces the delivery on the channel `aeolus_delivery_pending`.

`ship.receive` and `ship.ack` take the crew token only (the console session is refused) and need the `messages:receive` scope. `ship.receive` takes `{ "max": 1 to 10 }`, one when left out, and answers `{ "deliveries": [...] }`: the crew's own unacknowledged deliveries in flight first, then the oldest pending ones for its ship or its type. Each comes with its message (`deliveryId`, `messageId`, `senderShipId`, `recipient`, `payload`, `contentType`, `inReplyTo`, `sentAt`, `attempts`) and stays in flight until acknowledged or the lease ends; the crew's next receive returns it again, counted as another claim, so a lost reply loses nothing. The fifth claim of a delivery never acknowledged makes it undeliverable instead. With nothing there, a receive waits about 25 seconds and answers with no deliveries; a delivery for its ship or type wakes it at once. `ship.ack` takes `{ "deliveryId": "dlv_..." }` and answers `{}`: only the ship holding the delivery in flight acknowledges it, and acknowledging it again is OK.

The server listens on `aeolus_delivery_pending` over a connection of its own (named `aeolus-delivery-listener` in Postgres), which needs a direct database connection, not a transaction pooler. After a lost connection it listens again, with a delay that doubles up to 30 seconds, and every waiting receive then looks again, since notices sent meanwhile are gone.

No text input to any procedure may hold the character U+0000, which Postgres cannot store: it is refused as `BAD_REQUEST`, naming the field. A refusal answers its own code and message. A server failure answers only `Internal error` and the request's id (`data.requestId`); the server log holds the whole error, stack included, under the same id (`reqId`). No answer ever carries a stack trace.
