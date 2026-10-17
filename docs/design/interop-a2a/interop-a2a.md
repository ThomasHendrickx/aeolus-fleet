# A2A interop: level 3 against level 2

Design study by designer-4. Read only: it decides nothing. It builds on docs/design/scope-rework/scope-rework.md (branch design/scope-rework), part 0: question 25 (an app is a ship), 0.8 (contained fleet access), 0.9 (discovery and what a ship states) and question 55, which names the three levels. Numbers like 0034 are decisions in docs/decisions.

The levels, as set out on 17 Oct:

1. **Borrow the shapes.** A ship's statement uses the agent card's and MCP's tool fields, as Aeolus data.
2. **Speak the formats.** Each ship's statement is a valid A2A agent card, an app ship's capabilities a valid MCP tool list, served by the fleet.
3. **Speak the protocols.** Outside A2A agents and MCP clients discover and talk to fleet ships through the fleet, with durable delivery underneath.

## Sources read (17 Oct 2026)

- A2A releases: https://api.github.com/repos/a2aproject/A2A/releases. v1.0.1 (2026-05-28), v1.0.0 (2026-03-12), v0.3.0 (2025-07-30).
- A2A specification at tag v1.0.1: https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/docs/specification.md. Its header and https://a2a-protocol.org/latest/specification/ both say "Latest Released Version 1.0.0".
- A2A normative data model, package `lf.a2a.v1`: https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/specification/a2a.proto.
- What changed in 1.0: https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/docs/whats-new-v1.md.
- Discovery: https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/docs/topics/agent-discovery.md.
- Governance: an a2a-protocol.org blog post of 2026-08-27 says A2A is a Growth Stage project at the Agentic AI Foundation, which also hosts MCP.
- MCP 2026-07-28 as scope-rework 0.9 cites it. It was not re-read for this study.

What moved since early 2025:
- **Discriminators.** The `kind` discriminators are gone.
- **Interfaces.** `protocolVersion`, `preferredTransport` and `additionalInterfaces` became `supportedInterfaces[]`.
- **Streaming end.** `final` left TaskStatusUpdateEvent: the stream closing ends it.
- **Enums and names.** Enums are `TASK_STATE_*` and `ROLE_*` strings, and `mimeType` became `mediaType`.
- **Methods.** The methods are renamed (`SendMessage`, `GetTask`, `SubscribeToTask` and so on).
- **New in 1.0.** A `tenant` field and an `A2A-Version` header (Major.Minor).
- **Blocking.** A send blocks by default unless `returnImmediately` is set.

Two points the spec text and the proto disagree on, unresolved here:
- **SubscribeToTask verb.** The text says POST; the proto annotation says GET.
- **Push config fields.** The what's-new page says `configId` and `createdAt`; the proto has `id` and no `createdAt`.

## What exists today, precisely

| Part | Exists | Not there |
| --- | --- | --- |
| `/mcp` (0015, `packages/core/src/adapters/mcp/mcp-endpoint.ts`) | The ship contract as MCP tools (`register`, `send`, `receive`, `ack`, and so on), plus `fleet_*` actions for ships with fleet scopes. Stateless, with the crew token as a tool argument. An MCP client crews a ship with it | Calling a ship's capabilities as tools. An MCP client sends messages; it never calls a CRM ship's capability as a tool |
| `/api/v1` REST and OpenAPI | The same procedures, with the bearer crew token | Any A2A shape |
| A ship's statement and discovery | Proposals only (0.9, questions 43 to 55) | Not built: no ship carries what it offers |
| A sender reading its message's delivery state | Only argo's console and `fleet:read` reads (which show every payload, 0.2) | No ship call answers "was my message acknowledged, or is it undeliverable" for the sender alone |
| A2A | Nothing | Everything below |

## 1. What level 3 means concretely for A2A

Every caller is a ship (0012), so each outside party gets a ship in the fleet. A separate process, the A2A gateway, crews those ships and speaks A2A on their behalf, the way the trierarch crews ships and holds their crew tokens (0026, 0.8).

**The gateway translates like NAT, both ways.** Each side sees only the gateway and an alias for the other side.

- **Outside.** An outside party sees the gateway's endpoint and one opaque alias per exposed ship, such as `a7k2q9`.
  - It never learns a fleet ship's name, id or crew token, nor the fleet's id.
  - The gateway keeps the alias table: alias to ship id, so a rename changes nothing outside.
  - Every A2A id the gateway hands out is opaque too: task ids, context ids, and the `messageId` it sends outbound. Each is a keyed hash (HMAC with the gateway's own key) of the fleet message id it stands for. It is the same on every retry, so idempotency holds, and it can be rebuilt without the table, but it reveals nothing.
  - A card's `name` and `description` come from the ship's statement, never from its ship name.
- **Inside.** Fleet ships see only the ship that stands for an outside party, by its name, type and labels.
  - They never see the outside URL, card endpoint or credential. Those stay in the gateway's store.
  - The statement the gateway writes for an `a2a-agent` ship carries the outside card's skills and description, without its `supportedInterfaces`, `securitySchemes` or `signatures`.

**Direction A: an outside A2A client reaches a fleet ship.**

1. An outside client fetches an agent card from the gateway. The card stands for a fleet ship (or a ship type). Its `supportedInterfaces[0].url` is the gateway, with `tenant` set to the ship's opaque alias, which the gateway maps to the fleet and the ship.
2. The client sends `SendMessage` (JSON-RPC, or `POST /message:send` over HTTP+JSON). Its credential goes in the `Authorization` header.
3. The gateway maps the credential to the outside client's ship, of type `a2a-client`, which the gateway crews. It then calls the fleet's `send`:
   - selector: the target ship by name, or a type;
   - payload: the A2A message;
   - content type, and the client's `messageId` as the idempotency key;
   - `inReplyTo` set when the client continues a task.
4. The fleet stores the message and checks network rules as for any send (0034). Only then does the gateway answer with a Task. The gateway records the task in its own store.
5. The fleet ship receives and acks as today (0001). It replies to the `a2a-client` ship by `inReplyTo`. The gateway receives that reply, acks it, and turns it into task status, a message or artifacts.
6. The client sees the result through `GetTask`, a `SendStreamingMessage` or `SubscribeToTask` stream, or a push notification to its webhook.

**Direction B: a fleet ship reaches an outside A2A agent.**

1. argo, or the gateway with the scope to commission, makes a ship for the outside agent, of type `a2a-agent`. The gateway reads the agent's card from `/.well-known/agent-card.json` and states it as that ship's statement (level 2 in reverse), so fleet ships discover it (0.9).
2. A fleet ship sends to the `a2a-agent` ship like any ship. Network rules apply by its labels.
3. The gateway takes the delivery as that ship's crew. It calls the outside agent's `SendMessage` with the opaque id derived from the fleet message id as `messageId` and the outside credentials it holds. It acks only once the outside agent accepted.
4. The gateway follows the outside task, by push config to the gateway's own webhook, by `SubscribeToTask`, or by `GetTask` polling. It sends each status change or artifact back to the original sender as a reply (`inReplyTo`). Every such send is durable once the fleet answers OK.
5. `TASK_STATE_INPUT_REQUIRED` reaches the fleet ship as a reply. The ship's answer, `inReplyTo` that reply, becomes a `SendMessage` with the same `taskId` and `contextId`.

Core never speaks A2A in either direction. The gateway is a ship like squadrons (0017), and it reads only payloads addressed to and from its own ships. Core stays content-blind.

## 2. The mapping

Fit: **C** maps cleanly, **G** maps with a gap (named), **N** does not map.

| A2A 1.0 concept | Aeolus counterpart | Fit | The gap |
| --- | --- | --- | --- |
| AgentCard: `name`, `description`, `version`, `provider`, `iconUrl`, `documentationUrl` | A ship's statement (0.9; question 48 already borrows these fields), never its ship name | C | Exists only once the statement is built. `provider` is the organisation running the fleet; the statement has no such field |
| Card published at `/.well-known/agent-card.json`, one per host | Discovery (0.9), the fleet's own call | G | One well-known path per host, but a fleet has many ships, and a hosted server has many fleets (0020). Per-ship cards need their own URLs (the gateway's `/a2a/<alias>/agent-card.json`) or a catalogue. A2A does not standardise registries ("does not prescribe a standard API for curated registries") |
| Extended card (`GetExtendedAgentCard`, `capabilities.extendedAgentCard`) | Discovery answers per caller, by reach; question 50 lets only ships that can send to a ship read its statement | C | Fits well: the public card can say little, and the extended card, after auth, shows what the caller's reach allows |
| `signatures` (JWS over a JCS-canonical card) | None | N | A statement is a claim (0.9). Signing a card means the fleet vouches for it, which it does not. Leave it unsigned, or sign as "served by this fleet" only |
| `skills[]`: `id`, `name`, `description`, `tags`, `examples`, `inputModes`, `outputModes`, `securityRequirements` | A statement's capabilities | G | Media types map onto content types. But a skill has no input or output schema, and question 48 wants a JSON Schema per capability. The schema would travel in card `extensions` or the skill text. A per-skill `securityRequirements` has no counterpart: scopes are per ship |
| `defaultInputModes` / `defaultOutputModes` | The content types a ship takes and answers | C | None: it is a media type, and so is a content type |
| `capabilities.extensions[]` (uri, required, params) | None | G | The way to carry Aeolus's own facts (payload schema, delivery state) in standard form. A gateway-defined extension URI, not yet written |
| Message: `messageId`, `role`, `parts`, `contextId`, `taskId`, `referenceTaskIds`, `metadata` | Message: id, sender, payload, content type, `inReplyTo`, idempotency key | G | `messageId` maps to the idempotency key (unique per sender). `role` is the side: the `a2a-client` ship is `ROLE_USER`. A2A has no field for "replies to", so `inReplyTo` comes from `taskId` (the task's latest message) |
| Part: exactly one of `text`, `raw`, `url`, `data`, with `mediaType` and `filename` | One payload string with one content type | G | One text part maps to one payload with its media type, as is. Several parts, `data` or `raw` must travel as a whole A2A message as JSON, content type `application/a2a+json` (the spec's own media type). `raw` bytes go as base64 inside JSON. Over 64 KB is refused (0006), or carried by `url` as a reference |
| Task: `id`, `status`, `artifacts`, `history`, `metadata` | None in core. A message and its deliveries | N in core, G in the gateway | Core has no task (0001: distribution, not execution). The gateway keeps tasks, with an opaque task id derived from the first message's `msg_` id |
| `TASK_STATE_SUBMITTED` | Delivery `pending`, `received` or `handed` | C | Needs the sender to read its own delivery state (see "What exists today") |
| `TASK_STATE_WORKING` | Delivery `acknowledged` (and `handled`) | G | Acknowledged means received, not working (0001). A gateway can say WORKING after the ack only by convention |
| `TASK_STATE_COMPLETED`, `FAILED`, `REJECTED`, `INPUT_REQUIRED`, `AUTH_REQUIRED` | Only a reply from the ship can say these | N in core, G in the gateway | Aeolus does not follow work. Only a reply the fleet ship writes in A2A form (`application/a2a+json` holding a status, a message or an artifact) says completed, failed and so on. A plain-text reply is ambiguous: either a final `ROLE_AGENT` message (direct Message, no task) or completed. That is a rule the gateway invents |
| `FAILED` from the fleet side | `undeliverable`, `abandoned` (retired), `dismissed` | G | Clean in meaning: the fleet gave up. Same gap: the sender cannot read it today |
| `TASK_STATE_CANCELED`, `CancelTask` | None | N | Aeolus cannot withdraw a sent message. The gateway can only send the ship a cancel request and report what the ship answers, or answer `TaskNotCancelableError`. Cancel is idempotent in A2A, which is easy |
| Blocking `SendMessage` (the default) | `send` answers once stored, never waits for a reply | G | The spec blocks until a terminal or interrupted state. A ship may answer in an hour or never (0001). The gateway can wait a bounded time, then answer the task as SUBMITTED or WORKING. Whether that is conformant is unclear |
| Direct Message response (SendMessageResponse is Task or Message) | A reply that comes within the wait | G | Only when the ship answers at once, which agents rarely do |
| Artifact: `artifactId`, `name`, `parts` | A reply's payload | G | As Part, inside `application/a2a+json` |
| `contextId` (groups tasks and messages; the server may set it and must reject one it cannot honour) | The thread of `inReplyTo` | G | No context in core. The gateway mints it and keeps the mapping to threads |
| `ListTasks` (filters, cursor pages) | None | G | The gateway's own store, scoped to the caller's ship |
| Streaming: `SendStreamingMessage`, `SubscribeToTask` (SSE of `StreamResponse`, the current Task first, closes at a terminal state) | `receive` and `inbox` wait up to 25 s; `NOTIFY` after commit (0003) | G | The gateway holds SSE open and feeds it from the `a2a-client` ship's inbox. Nothing is lost on a dropped stream: `SubscribeToTask` sends the current Task first, from the gateway's store. A stream to a ship that never answers stays open with no end |
| Push notifications: `TaskPushNotificationConfig` (`url`, `token`, `authentication`), POST of a StreamResponse, "at least once", "MAY give up" | None (a ship pulls; the trierarch pushes into sessions, 0040) | G | The gateway posts webhooks with its own retries. A2A lets a sender give up; the gateway's store keeps the state, so GetTask still answers. Durable fleet-side, best effort at the webhook |
| Bindings: JSON-RPC, gRPC, HTTP+JSON (functionally equivalent), `A2A-Version` header | tRPC, REST, MCP over one router (0004) | G | The gateway needs at least one binding. JSON-RPC and HTTP+JSON both run on Fastify; gRPC is a separate stack |
| `tenant` (routes many agents behind one endpoint; clients copy it into every request) | The ship's opaque alias, mapped by the gateway to fleet and ship | C | Its format is opaque by the spec, so an alias fits, and no fleet or ship name crosses to the outside |
| Security schemes: `apiKey`, `http` bearer, `oauth2` (authorization code with PKCE, client credentials, device code), `openIdConnect`, `mtls`; credentials in headers on every request | The crew token as a bearer (REST); the ship secret only to `register` | G | Bearer maps directly (`httpAuthSecurityScheme`, `bearerFormat`). OAuth or OpenID Connect needs an issuer Aeolus does not have (blueprint, "Deferred": short-lived JWTs). mTLS needs certificate handling at Caddy |
| Authorisation: the server authorises each operation and scopes results to the caller (section 13.1) | Scopes on the server (0002); network rules at send (0034) | C | As long as the outside caller is its own ship. A gateway sending as one shared ship would put every outside caller under one set of rules |
| Idempotency: send "MAY be idempotent", by `messageId` | `send` is idempotent per sender key | C inbound, G outbound | Inbound is stronger than A2A asks. Outbound, an outside server may run a retried message twice |
| Durability | Stored before OK (0003) | G | The spec states none for send. The fleet's promise ends where the outside agent's begins |

## 3. What Aeolus would need to build

### In core (small, and wanted without A2A too)

1. **A ship's statement and discovery** (0.9, questions 43 to 54). The cards come from them. Level 2 needs this already.
2. **A sender reads its own messages' delivery states.** A ship procedure such as "my sent message and the state of each delivery", scoped to messages the caller sent, without `fleet:read`. Without it, a task never moves from SUBMITTED, and undeliverable never becomes FAILED.
   - Alternative: the fleet tells the sender when a delivery goes undeliverable, by a message. But 0040 declined the fleet speaking for a ship; question 3.
3. **Nothing else in core.** The gateway is a client of the public API, as squadrons is.

### `@aeolus-fleet/a2a-gateway`, a separate package and process

It sits beside squadrons and the trierarch plugin: an optional package, its own database, connected and switched per fleet as squadrons is (0017, 0021).

| Part | Does |
| --- | --- |
| A2A server (inbound) | JSON-RPC and HTTP+JSON bindings at `/a2a/...`, behind Caddy. `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, the push config calls, `GetExtendedAgentCard` |
| Card server | A public card per exposed ship or type, and the extended card per caller from discovery |
| Task store | Task id (opaque, derived from the first `msg_` id) and the mapping back, context id, the alias table, the caller's ship, state, history, artifacts, push configs, and the last fleet event applied. Scoped per fleet (0007) |
| Crew of outside ships | Holds the crew tokens of every `a2a-client` and `a2a-agent` ship, as the trierarch holds its ships' tokens (0.8). Receives and acks for them |
| Fleet-to-task translator | Turns reply payloads (`application/a2a+json`, plain text) and delivery states into task states. This is where content is read, in the gateway, never in core |
| A2A client (outbound) | Calls outside agents with the stored credentials, follows their tasks, and sends results back into the fleet as replies |
| Webhook sender and receiver | Posts outbound push with retries and backoff; takes outside agents' push into the gateway |
| Console page (optional) | Its own UI per scope-rework question 30: the outside clients, their credentials, and the outside agents |

### Endpoints

- **Cards.** `GET /a2a/<alias>/agent-card.json` (public), and `GET /a2a/extendedAgentCard` (after auth, the caller's ship read from its credential), or the `tenant` form of the HTTP+JSON paths (`/{tenant}/message:send`).
- **Well-known.** `/.well-known/agent-card.json` on a fleet's own host: a card for the fleet's front door, or none (question 2).
- **Webhook.** `POST /a2a/webhooks/<id>`, where outside agents push to the gateway.

### Identity and auth mapping

- **Inbound.** The outside client presents a credential the gateway issued for its `a2a-client` ship: an API key or bearer token at first, with OAuth client credentials later. The gateway maps it to that ship and calls the fleet with that ship's crew token. The outside client never sees a crew token. A fleet ship sees the `a2a-client` ship as the sender, with its name, type and labels. Answers go back to it by name, as today.
- **Outbound.** The gateway stores per `a2a-agent` ship the credentials its card's `securitySchemes` ask for. These are secrets in the gateway's database, which the hosting service must protect. `AUTH_REQUIRED` from an outside agent reaches the fleet ship as a reply, but the fleet ship holds no outside credentials. The gateway, or argo, must supply them (question 6).
- **Commissioning.** Either argo commissions each outside ship in the console and connects it to the gateway, or the gateway holds `fleet:manage` and commissions on argo's request (question 4).

### How network rules and scopes still apply

- **Scopes.** An `a2a-client` ship holds `messages:send` and `messages:receive` only, set at commission (0002), so an outside caller can never reach fleet actions through the gateway.
- **Rules.** The gateway labels its ships (`a2a=client`, `a2a=agent`, with `labels:define` and `labels:assign`) and may declare rules on its own labels (0037). argo's rules decide which fleet ships an outside client reaches, checked at every send. With no networking plugin, the fleet is all-to-all (0035), so an outside client reaches every ship: question 5.
- **Answers.** An answer to a received message's sender always passes (0034), so a fleet ship can always answer the outside client that asked.
- **Discovery** shows the outside client only the ships it can send to (0.9), and the extended card follows it.

### Where the delivery guarantee holds and where it cannot

| Leg | Holds? | Why |
| --- | --- | --- |
| Outside client to fleet | Yes | The gateway answers SendMessage only after the fleet's `send` OK. `messageId` is the idempotency key, so a retry or a gateway crash before answering makes no second message. The task id is derived from the message id, so the task is rebuilt from the fleet if the gateway lost its row |
| Fleet ship's reply to the outside client | Yes, to the gateway's store | The gateway acks a reply only after it stored it in its task store, the "ack on receipt" moment for the gateway's ship. After that, it is the gateway's database's promise |
| Gateway to outside client by stream or webhook | Best effort, recoverable | SSE drops and webhooks fail. A2A says push is at least once and a sender may give up. GetTask and SubscribeToTask always serve the stored state, so nothing is lost, but nothing reaches a client that never asks again |
| Fleet ship to outside agent | At least once | The gateway acks the fleet delivery only once the outside agent answered SendMessage. A crash between the outside answer and the ack sends again, with the same derived `messageId`. The outside agent "MAY" dedupe, so a double run is possible. Five failures make it undeliverable on Health (0040), as for any ship |
| Outside agent's result back to the fleet ship | Yes, once received | Each status or artifact is a fleet send with an idempotency key derived from the outside task id and its event, so it is durable before the gateway acknowledges the webhook |
| Task state in general | Cannot be guaranteed | COMPLETED and FAILED come from the fleet ship's own replies. A ship that never answers leaves a task WORKING forever. Aeolus has no rule to fail it, and inventing one is policy (0016) or following work (0001) |

### MCP at level 3, in one paragraph

The same gateway, or a second one, could serve an app ship's capabilities as an MCP server at its own path. `/mcp` stays the ship contract and must not mix the two. `tools/list` would be the statement's capabilities, and `tools/call` a send plus a wait for the reply, or the MCP Tasks extension with `tasks/get` polling. The task problem is the same as A2A's and gets the same answer.

## 4. Level 2 against level 3

| | Level 2: speak the formats | Level 3: speak the protocols |
| --- | --- | --- |
| What a customer gets | A2A and MCP tooling can read the fleet's ships as standard cards and tool lists: inspectors, catalogues, their own registry. The statement is checked against a standard shape. Talking still needs Aeolus's ship contract (`/mcp`, REST) and a crewed ship | An agent built on any A2A SDK, or any A2A-speaking platform, talks to fleet ships with no Aeolus client, and fleet ships call outside A2A agents as if they were ships. That lowers the barrier to entry |
| Honest limit | A valid card must name a `supportedInterfaces` url and binding. Pointing it at `/mcp` or REST is not A2A, so a standard client reads the card and can do nothing with it (question 55's point) | Task states other than submitted and failed depend on fleet ships answering in A2A form. A blocking send cannot be served faithfully. Outbound runs at least once, not exactly once |
| Where it lives | Core: two read endpoints over the statement, mapping functions in common | A new optional package and process, plus one core procedure |
| Rough size | 2 to 3 slices after the statement and discovery exist: card and tool-list mapping in common, the read endpoints, validation tests against the v1.0.1 proto's JSON form | 8 to 12 slices: inbound binding and task store, streaming, push, identity mapping and console, outbound client and webhooks, the sender delivery-state call in core, and conformance tests. A JS SDK from the A2A project exists (a2aproject/a2a-js), but its 1.0 support was not checked here |
| Upkeep as the spec moves | Low: the card schema. 0.3 to 1.0 renamed fields and merged three into `supportedInterfaces`, a mapping change | Medium to high: methods, streaming events, push config and errors all changed from 0.3 to 1.0, and the text and proto disagree on details today. Every major is a gateway release, and pre-1.0 Aeolus (0013) can follow, but customers' agents pin versions |

One line each:
- **Level 2:** the fleet's ships become legible to standard tools, but only Aeolus clients can talk to them.
- **Level 3:** standard A2A agents talk to fleet ships and are talked to, over Aeolus's stored-before-OK delivery, through a gateway that holds the task lifecycle Aeolus does not.

## 5. Risks and open questions for Thomas

1. **Where does the task lifecycle live?**
   - Options:
     - (a) in the gateway only, from reply payloads and delivery states;
     - (b) a task concept in core;
     - (c) no tasks: the gateway always answers a direct Message and nothing more.
   - Pick: (a). 0001 keeps core out of following work. (c) breaks every A2A client that expects a task.
2. **How are cards published, given many ships per fleet and many fleets per hosted server?**
   - Options:
     - (a) a card per ship at a gateway path, with an opaque alias as the `tenant`, plus a catalogue for discovery;
     - (b) one card per fleet at the fleet host's `/.well-known/agent-card.json`, its skills the reachable ships;
     - (c) a subdomain per ship.
   - Pick: (a). A card is one agent. (b) blurs which ship answers, and (c) costs DNS and certificates per ship.
3. **How does a sender learn its delivery's state?**
   - Options:
     - (a) a new ship call for one's own sent messages and their delivery states;
     - (b) the gateway holds `fleet:read`;
     - (c) the fleet messages the sender on undeliverable.
   - Pick: (a). (b) reads every payload in the fleet (scope-rework 0.2). (c) has the fleet speak for a ship, which 0040 declined.
4. **Who commissions the ship of an outside client or agent?**
   - Options:
     - (a) argo, in the console, connecting it to the gateway;
     - (b) the gateway with `fleet:manage`, on argo's request in the gateway's UI;
     - (c) self-service: an outside client signs up through OAuth dynamic registration.
   - Pick: (a) first. Commissioning a ship that outsiders crew is argo's call (0016). (c) needs an authorisation server Aeolus lacks.
5. **No networking plugin means all-to-all (0035), outside callers included.**
   - Options:
     - (a) leave it: the operator's call;
     - (b) the gateway refuses to switch on in a fleet without a networking plugin;
     - (c) the gateway declares rules (0037) letting its ships reach only ships labelled for it.
   - Pick: none here. (b) and (c) are protective rules, and whether they are policy under 0016 is Thomas's to say. (c) is the only one that uses an existing mechanism.
6. **Outbound credentials and AUTH_REQUIRED.**
   - Options:
     - (a) argo stores each outside agent's credentials in the gateway, and AUTH_REQUIRED goes to argo;
     - (b) the fleet ship supplies them in its message;
     - (c) client credentials only; outside agents that need a user's login are out of scope.
   - Pick: (a) with (c) at first. Secrets in a payload would sit in the fleet's history, readable by `fleet:read`.
7. **The blocking default.**
   - Options:
     - (a) wait a bounded time for a reply, then answer the task as it stands;
     - (b) answer at once as if `returnImmediately` were set;
     - (c) refuse blocking sends.
   - Pick: (a), with the bound in the gateway's configuration. Conformance against the spec's "waits until terminal or interrupted" is a risk to check with the A2A conformance tests.
8. **What reply form must a fleet ship use to drive a task?**
   - Options:
     - (a) `application/a2a+json` carrying an A2A Message, status or artifact, with plain text read as a final agent message;
     - (b) an Aeolus content type for task status;
     - (c) plain text only, always completed.
   - Pick: (a). It is the spec's own media type, so no new vocabulary, and a ship that knows nothing of A2A still works with text.
9. **Exactly-once to outside agents.** A2A send is only "MAY be idempotent", so a fleet message can run twice at an outside agent after a crash.
   - Options:
     - (a) accept and document it: at least once, `messageId` stable;
     - (b) the gateway keeps an outbound log and never re-sends a message whose answer it lost, marking it undeliverable instead.
   - Pick: (a). (b) trades a rare double run for a lost send, which the promise forbids.
10. **The 64 KB limit against A2A parts.**
    - Options:
      - (a) refuse over 64 KB with a clear A2A error;
      - (b) the gateway stores large parts and passes a `url` part;
      - (c) raise the limit for gateway ships.
    - Pick: (a) first. 0006 says the content lives where the reference points; (b) makes the gateway a file store.
11. **Which bindings?**
    - Options:
      - (a) JSON-RPC and HTTP+JSON;
      - (b) all three, gRPC included;
      - (c) JSON-RPC only.
    - Pick: (a). Both run on the existing Fastify stack. gRPC adds a second server stack, and the spec requires equivalence, not every binding.
12. **Does level 2 ship before level 3?**
    - Options:
      - (a) level 1 now (question 55's pick), level 2 only together with level 3;
      - (b) level 2 on its own first;
      - (c) straight to level 3.
    - Pick: (a). A card that names no A2A interface is form without use, and level 2's real work is the mapping that level 3 needs anyway.
13. **Spec drift risk.** Today the text and the proto disagree (the SubscribeToTask verb, the push config fields), and the site says 1.0.0 while v1.0.1 is tagged. A gateway built now follows the proto as the normative source and pins `A2A-Version: 1.0`. Flagged only, no options.
