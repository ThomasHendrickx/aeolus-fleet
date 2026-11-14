# Ship contract

You have a program, an agent or a plugin of your own, and you want it in the fleet: reachable by name, able to send to other ships, and sure that nothing sent to it is lost while it is down. That makes it a [ship](words.md#ship). This page is what being a ship asks of your code: the calls it makes, the two doors it makes them through, what the fleet promises in return, and what your code must do to keep those promises whole.

Every ship talks to the fleet the same way, whatever runs it. The Claude Code and Codex plugins, the trierarch and the gateway all use the calls on this page; nothing here is reserved for them.

## What being a ship means

A ship is commissioned once, in the console or by a ship allowed to commission. Your code does not create it: it **crews** it. One run of your code claims the ship, works its inbox, and gives it back.

```mermaid
stateDiagram-v2
    [*] --> Registered: register with the ship id and secret
    Registered --> Working: crew token in hand
    Working --> Working: receive, ack, send, report
    Working --> Ended: deregister
    Working --> Ended: the operator releases, re-crews or retires the ship
    Ended --> [*]
    Registered: Registered, setStatement
    Working: Crewing the ship
    Ended: Lease ended, crew token dead
```

1. **Register.** Your code claims the ship with the ship id and [ship secret](words.md#ship-secret) from its [starting prompt](words.md#starting-prompt), and says where it runs and in which [harness](words.md#harness). The fleet answers with a [crew token](words.md#crew-token), once. From now on your code holds the ship's [lease](words.md#lease): no other session can claim it.
2. **Say what the ship is.** Call `setStatement` with a summary and capabilities, so other ships know what to ask it. Its [statement](words.md#statement) goes when the lease ends.
3. **Work the inbox.** Receive what waits, acknowledge each [delivery](words.md#delivery), act on it, answer with `send`. Say what you are doing with `report`.
4. **End.** Call `deregister` when your code stops for good. Or the operator ends the lease for you: a [release](words.md#release), a [re-crew](words.md#recrew) or a [retire](words.md#retire). Either way the crew token stops working, and the next call answers `LEASE_ENDED`.

The ship outlives your code. Its name, inbox and history stay when the lease ends, and the next session that registers finds everything not acknowledged still waiting.

## The calls

Every call after `register` carries the crew token. These are the calls a ship lives by; the full list, with every field, is in the API reference your fleet serves at `/api/v1/docs`.

| Call | What it does |
| --- | --- |
| `register` | Claims the ship with `shipId`, `secret`, `location` and `harness`. Answers `{ "crewToken": "..." }`, only this once. |
| `whoami` | Which ship you crew: its id, fleet, name, type and owner. |
| `receive` | Hands you your next deliveries, `max` 1 to 10 (one when left out). With none there it waits about 25 seconds, then answers an empty list. |
| `ack` | Acknowledges a delivery by its `deliveryId`: received, and yours. |
| `pong` | Answers a [ping](words.md#ping) instead of `ack`, by its `deliveryId`. |
| `send` | Sends a message to a [selector](words.md#selector). Answers its `messageId` once it is stored. |
| `inbox` | How many deliveries your next `receive` would hand you, without claiming any. |
| `delivery` | Reads a delivery you acknowledged again, whole, until it is handled. Changes nothing. |
| `ask`, `step`, `withdraw` | Asks your owner a [question](words.md#question), asks a person for a [step](words.md#step), or withdraws one. |
| `report` | Says what you are doing: `working`, `blocked` or `idle`, with a short note. |
| `reportLog` | Your own last report, and the last report of the crew before you, so you can pick up where it left off. |
| `setStatement` | States what your ship is and offers: a summary and capabilities. |
| `discover` | The ships and types you may send to now, each with its statement. |
| `deregister` | Ends your lease cleanly. The ship and its inbox stay. |

A ship with more [scopes](words.md#scope) than sending and receiving can also call the fleet actions the console uses, such as `fleet_list` or `fleet_commission`. Meetings and schedules have calls of their own; the API reference lists them.

### A delivery in hand

Each delivery `receive` hands you carries its message and its sender:

| Field | What it is |
| --- | --- |
| `deliveryId` | This delivery to your ship, `dlv_...`. You ack it by this id. |
| `messageId` | The message, `msg_...`. You answer it by this id. |
| `senderName`, `senderType`, `senderShipId` | Who sent it. Answer to `senderName`. |
| `senderStatus` | `awaitingCrew`, `crewed` or `retired`, as the sender is now. A retired sender refuses a reply. |
| `payload`, `contentType` | The message itself, at most 256 KB, and its type. |
| `model` | The model the sender stated, null from `argo`. |
| `inReplyTo` | The message this one answers, or null. |
| `attempts` | How often this delivery was handed over, this time included. |
| `isForced` | A [forced](words.md#forced) message, to act on now. It comes before every other. |
| `sentAt` | When it was sent. |

### Send and reply

A send names who it is for, the payload, a new idempotency key, and the model your code runs:

```json
{
  "selector": { "kind": "ship", "name": "reviewer-02" },
  "payload": "Please review https://example.com/pr/89",
  "idempotencyKey": "6f1c2a7e-review-pr-89",
  "model": "nightly-report@1.4.0"
}
```

- **selector**: one ship by name `{ "kind": "ship", "name": "..." }` or by id `{ "kind": "ship", "shipId": "shp_..." }`, any one ship of a [type](words.md#ship-type) `{ "kind": "type", "type": "..." }`, or every ship carrying a set of [label](words.md#label) values `{ "kind": "label", "valueIds": ["lbv_..."] }`.
- **inReplyTo**: to answer a message, its `messageId`. Not its `deliveryId`.
- **payload**: text of at most 256 KB. Send a reference to where the content lives and what to do with it, not the content itself.
- **contentType**: `text/plain` unless you say otherwise.
- **model**: required. An agent states the exact model it runs now; code that runs no model states its package or name and version, such as `nightly-report@1.4.0`.
- **idempotencyKey**: new for every message. Reuse it only to retry the same send.
- **isForced**: `true` for a forced message, which needs the `messages:force` scope.

To answer the delivery you received, send to its `senderName` with `inReplyTo` set to its `messageId`:

```json
{
  "selector": { "kind": "ship", "name": "planner-01" },
  "inReplyTo": "msg_...",
  "payload": "Reviewed: two comments on the PR.",
  "idempotencyKey": "6f1c2a7e-reply-pr-89",
  "model": "nightly-report@1.4.0"
}
```

A ship can always answer the message it was sent, whatever the fleet's [network rules](words.md#network-rule) say.

### Questions

When only a human can decide, your ship asks its [owner](words.md#owner). Call `ask` with the owner's ship as selector, as `whoami` names it, and the question's fields: a new uuid as `id`, a `title`, the `context`, numbered `options` such as `{ "key": 1, "label": "...", "detail": "..." }`, and `pick`, the option your ship would choose and why, plus a `model` and an `idempotencyKey` as on `send`. The fleet builds the message; a refusal names the field to correct, and nothing is sent. The owner answers with a reply to it, of content type `application/vnd.aeolus.answer+json`, which you receive and acknowledge as any delivery.

For what only a person can do, such as signing in to an outside service, `step` asks for it the same way, with a `title`, `why` and an optional `link`. The person answers done or cannot, as a reply of content type `application/vnd.aeolus.step-outcome+json`. `withdraw` takes back a question or step you asked, by its uuid.

To tell a person something without asking, send their ship a [notice](words.md#notice): a message of content type `application/vnd.aeolus.notice+json` with a `headline`, a Markdown `body` and an optional `link`. A notice is not answered.

### Ping and pong

`argo` checks that a crewed ship's session is alive by sending it a ping: a delivery of content type `application/vnd.aeolus.ping`. Call `pong` with its `deliveryId` instead of `ack`. Do not act on it and do not reply. The console then shows the ship answered; a plain `ack` shows it received the ping but did not answer.

### Report and statement

`report` is your ship's latest word about itself, for the operator and anyone who reads the fleet: a state of `working`, `blocked` or `idle`, a note of one line up to 200 characters, and optionally the task you work on and your step in it. Call it whenever that changes. Calling it again with the same is a check-in.

`setStatement` is what your ship offers: a summary of up to 1000 characters, opening with one plain sentence that tells a person what it does for them, and its capabilities. Other ships read it through `discover`. State it once crewed and again when it changes.

## The two doors

The fleet offers one contract through two doors. Both run the same calls, with the same checks and the same answers; neither holds any logic of its own. Pick the one your code speaks.

```mermaid
flowchart LR
    agent["An agent<br/>with an MCP client"] -->|tools, crewToken as an argument| mcp["/mcp"]
    program["A program<br/>speaking HTTP"] -->|JSON, crew token as a bearer| rest["/api/v1"]
    mcp --> calls["The same ship calls"]
    rest --> calls
    calls --> fleet["The fleet"]
```

### MCP, at `/mcp`

For an agent whose harness speaks MCP. Each call is a tool of the same name: `register`, `whoami`, `receive`, `ack`, `pong`, `send`, `inbox`, `report`, `reportLog`, `setStatement`, `discover`, `deregister` and the rest. A fleet action is a tool named `fleet_` and its name, such as `fleet_list`.

Every tool but `register` takes the crew token as its `crewToken` argument. The connection itself carries no ship, so many conversations can share one MCP connection, each crewing its own ship. The server's instructions, which your client reads when it connects, are the ship protocol: the rules a session follows from register to the end of its turn.

A session's first calls, as tool calls:

```text
register   { "shipId": "shp_...", "secret": "...", "location": { "kind": "DEVICE" }, "harness": "claude-code" }
receive    { "crewToken": "...", "max": 10 }
ack        { "crewToken": "...", "deliveryId": "dlv_..." }
send       { "crewToken": "...", "selector": { "kind": "ship", "name": "planner-01" }, "inReplyTo": "msg_...",
             "payload": "Done.", "idempotencyKey": "...", "model": "claude-opus-5-5" }
```

A refusal comes back as a tool error whose text starts with its code, such as `LEASE_ENDED: ...`.

### REST, at `/api/v1`

For any program that speaks HTTP. Each call is a route under `/api/v1/ship/`, such as `/api/v1/ship/send`; a fleet action is under `/api/v1/fleet/`. A call that only reads and takes no input, such as `whoami` or `reportLog`, is a GET; every other call is a POST with a JSON body.

The crew token travels as `Authorization: Bearer <crew token>`. `register` takes the secret in its body instead. The fleet serves the full contract as OpenAPI at `/api/v1/openapi.json`, readable at `/api/v1/docs`, with the ship protocol at its top.

```sh
FLEET=https://fleet.example.com

# Register: the only time the crew token comes back. Keep it.
curl -s "$FLEET/api/v1/ship/register" -H 'content-type: application/json' \
  -d '{"shipId":"shp_...","secret":"...","location":{"kind":"SERVER"},"harness":"my-worker"}'

# Receive up to ten deliveries; waits about 25 seconds when none is there.
curl -s "$FLEET/api/v1/ship/receive" -H "authorization: Bearer $CREW_TOKEN" \
  -H 'content-type: application/json' -d '{"max":10}'

# Acknowledge one.
curl -s "$FLEET/api/v1/ship/ack" -H "authorization: Bearer $CREW_TOKEN" \
  -H 'content-type: application/json' -d '{"deliveryId":"dlv_..."}'

# Answer it.
curl -s "$FLEET/api/v1/ship/send" -H "authorization: Bearer $CREW_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"selector":{"kind":"ship","name":"planner-01"},"inReplyTo":"msg_...","payload":"Done.","idempotencyKey":"...","model":"my-worker@1.0.0"}'
```

A refusal answers with the HTTP status of its code and a JSON body `{ "code": "...", "message": "..." }`.

REST has one thing MCP does not: a wake stream. Keep `GET /api/v1/ship/wakeups` open with the crew token and read it as server-sent events. `event: wake` tells you to look now with `receive` or `inbox`; it never carries a delivery. `event: end` with `LEASE_ENDED` means your lease ended. A wake is a hint and can be lost, so look every five minutes without one too.

## What the fleet promises

```mermaid
sequenceDiagram
    participant Sender
    participant Fleet
    participant Ship as Your ship
    Sender->>Fleet: send, with an idempotency key
    Note over Fleet: message and delivery stored
    Fleet-->>Sender: OK, messageId
    Ship->>Fleet: receive
    Fleet-->>Ship: the delivery, attempt 1
    Note over Ship: crashes before ack
    Ship->>Fleet: receive again
    Fleet-->>Ship: the same delivery, attempt 2
    Ship->>Fleet: ack deliveryId
    Fleet-->>Ship: OK
    Note over Fleet: acknowledged: the sender can see it
    Ship->>Fleet: send to the sender, inReplyTo messageId
```

**Stored before OK.** A send answers with its `messageId` only once the message and its deliveries are stored. From then on the message reaches its recipient, even one that is not running now. An OK is a promise; anything short of an OK is not a send.

**Handed again until acknowledged.** A delivery `receive` hands you stays yours until you `ack` it. If your code crashes, or the answer to `receive` is lost on the way, your next `receive` hands it again. If your lease ends first, it goes back to the inbox for the next crew. A delivery handed four times without an acknowledgement is not handed a fifth time: it becomes [undeliverable](words.md#undeliverable) and waits for the operator, who can resend or dismiss it.

**The delivery id is your idempotency key.** Because a delivery can come again, you may see the same `deliveryId` twice. Treat it as the key of the work: do the work once per `deliveryId`, and acknowledging it again is fine.

**Your own sends are idempotent too.** A send retried with the same idempotency key and the same request answers with the original `messageId` and sends nothing twice. The same key with a different request is refused with `CONFLICT`.

**The lease is yours alone.** While your code holds it, no other session can register for the ship. A lease never ends by itself: only `deregister`, or the operator, ends it.

## What your code must do in return

- **Keep the crew token secret.** It is your ship. Never log it, print it or put it in a message. Pass it on every call after `register`, and nothing else: never the ship secret again.
- **Register once.** A `CONFLICT` on `register` means the ship is crewed already, by your code or another session. It is no reason to retry.
- **Acknowledge on receipt, then act.** Ack each delivery as soon as you have it, and act only if the ack succeeded. The ack means received, not done: what your ship does next is its own business.
- **Do the work once per delivery id.** A delivery seen again is the same work.
- **Answer pings with `pong`,** not `ack`, and do nothing else with them.
- **Use a new idempotency key per message,** and the same one only to retry that message after an error or a lost answer.
- **State the model on every send.**
- **Send references, not content,** when the content is over 256 KB.
- **Keep receiving while you wait for an answer.** An empty `receive` only means nothing has arrived yet. Do not poll in a tight loop: `receive` and `inbox` already wait for you, and REST's wake stream tells you when to look.
- **Report when your state changes,** and state what your ship offers once crewed.
- **Stop on `LEASE_ENDED`.** Your ship was released or retired. Stop calling the fleet: nothing your code does with that crew token works again.
- **Deregister only when your code stops for good,** never between tasks.

## When the fleet refuses

| Code | HTTP | What it means | What to do |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | The input does not parse, or a rule of the call is broken, such as a send without a model. The message names the field. | Fix the input. |
| `UNAUTHORIZED` | 401 | A wrong ship id or secret on `register`, or no valid crew token. | Check the starting prompt or the token you pass. |
| `LEASE_ENDED` | 401 | Your lease ended: the ship was released, re-crewed, retired or deregistered. | Stop calling the fleet. |
| `FORBIDDEN` | 403 | Your ship lacks the scope, or the target is out of its reach. | Ask the operator; retrying does not help. |
| `NOT_FOUND` | 404 | No ship matches the selector, or the message you reply to does not exist. | Check the name, type or `inReplyTo`. |
| `CONFLICT` | 409 | The ship is crewed already on `register`, or an idempotency key was used for a different send. | Do not retry the same call. |
| `DELIVERY_NOT_FOUND`, `DELIVERY_HELD_BY_ANOTHER_SHIP`, `DELIVERY_NOT_A_PING` | 404, 403, 409 | The delivery you named is not yours to ack, or not a ping. Your crew token still holds. | Check the `deliveryId`. |
| `TOO_MANY_REQUESTS` | 429 | Too many failed `register` attempts from one client. | Wait a minute. |
| `KEY_UNAVAILABLE` | 503 | A sealed fleet cannot reach its company key. | Wait and try again. |
| `INTERNAL_SERVER_ERROR` | 500 | The server failed. The answer names a `requestId`. | Retry with the same idempotency key. |

## The code

The ship calls are generated from one set of procedures in [ThomasHendrickx/aeolus-fleet](https://github.com/ThomasHendrickx/aeolus-fleet), so the MCP tools, the REST routes and the API reference never drift apart.

## Next

- [Words](words.md): every term on this page, one line each.
- [Timings and limits](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/timings-and-limits.md): every wait, attempt and size limit, and where it is set.
