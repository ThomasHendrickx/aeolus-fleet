# A2A in and out through the gateway

Design for [#878](https://github.com/ThomasHendrickx/aeolus-fleet/issues/878), the 0.30.0 part of level 3 (0048). This is new core fleet functionality, so the purpose comes first. Part 2 and the questions follow once Thomas agrees it. No code.

It brings two earlier designs up to date with what is built: the interop design (branch `design/interop`, `docs/design/interop/interop.md`, questions I-1 to I-9 decided on 17 Oct, slice order 3.6) and the A2A study (branch `design/interop-a2a`, `docs/design/interop-a2a/interop-a2a.md`). Every point they decided stays. Anything that now conflicts is raised as a question in part 4.

## 1. Purpose (to agree)

An outside A2A agent talks to fleet ships with no Aeolus client. Fleet ships talk to outside A2A agents as they talk to any ship. Network rules gate both directions as they gate any ship. No send answers OK before the message is stored.

- **A2A in.** A supplier's A2A agent, built on any A2A SDK, reads a card for the procurement ship and sends it a message. It follows the task until the ship's reply completes it. It sees one gateway address and an opaque alias, never a ship name. It reaches nothing the rules do not allow.
- **A2A out.** An outside A2A agent becomes a ship. A fleet ship finds it through discovery and sends it a message. The outside task's status and artifacts come back as replies. No session holds the outside agent's credential.
- **Every outside A2A party is a proxy ship with an owner.** A human answers for it (0045, 0056).

Not the purpose:
- Task state in core. The gateway keeps it (0048, 0001).
- A2A for person ships. People keep the gateway's MCP tools (0054).
- gRPC, signed cards, and a registry of cards.

## 2. Lessons to check against

### Decided, kept as is

| Point | Rule | Source |
| --- | --- | --- |
| Every caller is a ship | Each outside party gets its own proxy ship. The gateway decides no reach of its own | 0057, interop 2 |
| Policy stays in core | Network rules decide every send and every discovery (0034). Only a capability's own statement holds per-call timing (0047) | 0016, 0034 |
| Stored before OK | The gateway answers an outside call only after the fleet's `send` answered OK | 0003 |
| Completion rule | A call is completed by the first reply of the capability's output content type. A reply of `application/a2a+json` drives the state it carries. A question means input needed. A delivery failure or the deadline means failed | I-2, interop 3.4 |
| One wake pattern | The gateway is the computer side and reports `handed` with its channel (waker `gateway`) | I-1, 0040 |
| Delivery to outside agents | The gateway acks a delivery when the outside agent accepts it. A call that died before it was confirmed is handed again only when it is repeatable, otherwise `notHandled` with "the call may have run". A2A agents are repeatable by default | I-7, 0040 |
| One waiting call per proxy ship | No core call that waits on many ships | I-8 |
| Async by default | `waitMs` per capability, 0 by default, capped by the gateway | I-9, 0047 |
| One gateway, two adapters | One train, one repository | I-6, 0049 |
| The gateway commissions | It commissions a proxy ship once an outside party is approved | I-5, 0044, 0056 |
| Verified apart from stated | `a2aCardDomain` is already a check in the closed list | I-4, 0059 |
| Federation | Through pagasae, not a federation of the gateway's own. 0054 changed I-4 here; A2A is not affected | 0054 |
| One switch for outside parties per fleet | Off by default. Turning it on with no network rules applied warns | I-3, 0056 |
| NAT both ways | Outside, the gateway shows an opaque alias and HMAC ids. Inside, it shows the proxy ship's name, type and labels | A2A study 1 |
| 64 KB | A larger message is refused or carried as a reference | 0006 |
| Spec source | The proto is normative where the text disagrees. The gateway pins `A2A-Version: 1.0` | A2A study 13 |

### Built since 17 Oct

- **Core.** Everything in interop slice P is built:
  - the statement with `waitMs`, `deadlineMs` and `repeatable`, and discovery (0047);
  - kinds and owners (0044, 0045);
  - `receiveReply` and `sentMessage`;
  - the waker and the channel of `handed`;
  - `notHandled` with a reason;
  - verified facts (0059);
  - the re-read `delivery` (0040).
- **Gateway** (`aeolus-fleet-gateway`). MCP in and MCP out, and people. Parts A2A reuses:

  | Part | Where |
  | --- | --- |
  | Connection per fleet; the gateway's ship with `fleet:read`, `fleet:commission`, `fleet:on-behalf`, `scopes:declare`, `fleet:verify`; it declares `gateway:approve` | `src/core/connection` |
  | Parties (`mcpServer`, `mcpClient`): approval, commission, crew token, state | `src/core/parties` |
  | Proxy ship loops: `pushReceive`, `handed` (channel `mcp`), `ack`, `handled`, `notHandled` for a server; `receiveReply` per open call for a client | `src/core/mcp-out`, `src/core/mcp-in` |
  | Aliases: HMAC of fleet and ship, 8 characters. Handles: HMAC of the message id | `src/adapters/crypto` |
  | Call store (`client_calls`, `client_call_replies`) with deadline and output content type | `src/core/mcp-in` |
  | Statement written from an outside party's offer, with tool marks for `repeatable`; verified facts | `src/core/mcp-out` |
  | The vault: a bearer or OAuth client credentials | `src/core/vault` |
  | The outside-parties switch per fleet, with the warning | `outside_party_switches` |
  | `aeolus_ships` (discover) and `aeolus_send` (send by ship or type) for people | `src/adapters/http/person-tools.ts` |

  Nothing of A2A exists: no adapter, card, task view, webhook, A2A client or A2A party kind.

### The A2A specification on 21 Oct

- **No release after v1.0.1** (2026-05-28). On main, the proto changed only a comment, and the text got editorial fixes. Version 1.1 work sits on branch `dev-1.1` (task `generation`, `SendLiveMessage`, client-written artifacts).
- **SubscribeToTask verb: still open at v1.0.1.** The proto says GET, the text says POST. `dev-1.1` settles it as GET (#2068). Issue #1574 is open, and both official SDKs accept GET and POST on the server. **So the gateway serves both.**
- **Push config fields: settled.** `whats-new-v1.md` dropped `configId` and `createdAt` (#2056). The proto's `TaskPushNotificationConfig` (`tenant`, `id`, `task_id`, `url`, `token`, `authentication`) is the shape.
- **Unchanged:**
  - `SendMessage` blocks by default unless `return_immediately` is set;
  - `tenant`;
  - the `A2A-Version` header, which a client must send;
  - the card at `/.well-known/agent-card.json`;
  - an extended card only when the public card sets `capabilities.extendedAgentCard`.
- **Tooling:**
  - `@a2a-js/sdk` v1.3.0 implements 1.0 for server and client, over JSON-RPC, REST and gRPC.
  - The conformance kit `a2a-tck` targets 1.0. It has tags only; the latest is `1.0.0.alpha3`, from 20 Oct.

## 3. Flows

These follow the picks in part 4. "Gateway" means the gateway acting as the crew of the proxy ship named.

### 3.1 A2A in

```mermaid
sequenceDiagram
  participant C as Outside A2A client
  participant G as Gateway (crew of the client's proxy ship, type a2a-client)
  participant F as Fleet (core)
  participant S as Fleet ship
  C->>G: GET /gw/a2a/<alias>/.well-known/agent-card.json
  G-->>C: public card: gateway interface, bearer scheme, extendedAgentCard true, no skills
  C->>G: GetExtendedAgentCard (bearer)
  G->>F: discover (as proxy ship)
  alt alias not reachable now
    G-->>C: error, as for an unknown alias
  else reachable
    G-->>C: card from the ship's statement (summary, skills from capabilities)
  end
  C->>G: SendMessage (messageId, parts, A2A-Version 1.0)
  alt bad bearer, switch off, version unsupported, over 64 KB
    G-->>C: A2A error, nothing sent
  else
    G->>F: send (selector ship, payload, content type, idempotencyKey = messageId, inReplyTo when the message continues a task)
    alt refused (no rule, unknown, retired)
      F-->>G: refusal
      G-->>C: A2A error naming no ship
    else stored
      F-->>G: OK msg_
      G->>G: call row (task id = HMAC msg_, context id, deadline, output type)
      opt waitMs > 0 and not return_immediately
        G->>F: receiveReply (msg_), up to waitMs
      end
      G-->>C: Task (state from sentMessage and replies) or the Message
    end
  end
  S->>F: receive, ack, reply (inReplyTo msg_)
  G->>F: receiveReply (msg_)
  F-->>G: reply delivery
  G->>G: store reply on the call, apply rule 3.4
  G->>F: ack
  C->>G: GetTask / SubscribeToTask / push to C's webhook
  G-->>C: Task from the call store
  Note over G,F: the same messageId again: the fleet answers the same msg_, the call row exists, no second message
  Note over G: no completing reply by the deadline, or undeliverable / dismissed / abandoned (sentMessage): FAILED. A reply after FAILED is acked and kept, state unchanged
  Note over G,C: webhook down: retried, then given up. GetTask still answers the stored state
```

### 3.2 A2A out

```mermaid
sequenceDiagram
  participant S as Fleet ship
  participant F as Fleet (core)
  participant G as Gateway (crew of the agent's proxy ship, type a2a-agent)
  participant A as Outside A2A agent
  S->>F: discover, then send to the proxy ship
  F-->>S: OK (stored)
  G->>F: pushReceive (waker gateway)
  F-->>G: delivery (received)
  G->>F: handed n, channel a2a
  G->>A: SendMessage (messageId = HMAC msg_, vault credential, return_immediately)
  alt Task or Message answered
    G->>F: ack (the promise ends)
    loop until terminal
      G->>A: SubscribeToTask, or GetTask by polling
      A-->>G: status or artifact
      G->>F: send reply to S (inReplyTo msg_, key = HMAC task id and event)
    end
    G->>F: handled
  else no answer (stream broke, gateway crashed)
    alt repeatable (default for A2A)
      G->>F: handed n+1
      G->>A: SendMessage, same messageId
    else marked not repeatable
      G->>F: notHandled, "the call may have run; its answer was lost"
    end
  else refused (4xx, bad card, credential refused)
    G->>F: ack, reply to S carrying TASK_STATE_FAILED or REJECTED, handled
  end
  Note over G,A: INPUT_REQUIRED: a reply to S. S answers inReplyTo that reply; it arrives as a new delivery and goes out as SendMessage with the same taskId and contextId
  Note over G,A: AUTH_REQUIRED: a reply to S carrying the state, then handled. The owner fixes the credential on the gateway's page
  Note over G,A: task gone (not found) while followed after the ack: notHandled
  Note over G,F: fifth attempt: undeliverable, Needs attention (0040)
```

## 4. Questions

Each has options and my pick. They follow once the purpose is agreed.

**A1. An outside party covers A2A.** 0050, 0056 and the blueprint define an outside party as "an approved outside MCP server or client".
1. **Widen the term**: an approved outside MCP server or client, or A2A agent or client. Same approval, pending list, switch and owner rule. One line each in 0050, 0056 and the blueprint.
2. Keep A2A parties out of the approval flow: argo adds them.

Pick 1. 0057 makes no job argo's alone, and the gateway pages proposal already shows the protocol as a tag on one list.

**A2. How an outside A2A client is admitted and gets its credential.**
1. **An approver adds it on the gateway's page**, as an outside MCP server is added (0056). The approver names it and sets its owner and scopes. The gateway commissions an `a2a-client` proxy ship and shows a bearer once. The card states an HTTP bearer scheme.
2. OAuth authorization code through a signed-in account, as for an MCP client.
3. OAuth client credentials with a pre-registered client.

Pick 1, with 3 in a later slice. An A2A client is a machine with no browser, so 2 has no human to sign in. 1 needs nothing the gateway lacks.

**A3. What the public card shows.** 0047 lets only the ships that can send to a ship, and argo, read its statement. A public card is read by anyone who knows the alias.
1. **The public card** names the gateway as provider and states the interface, the bearer scheme and `extendedAgentCard: true`, with no summary and no skills. The extended card, after auth, carries the statement for that caller, from `discover`.
2. The public card carries the statement.

Pick 1. It keeps 0047's reader rule, and the extended card is the spec's own place for what is shown per caller.

**A4. How an A2A client learns which cards it can use.** A2A has no registry.
1. **The party's detail on the gateway's page lists the card address of each ship its proxy ship reaches now** (from `discover`). The owner hands those addresses to the outside party.
2. One gateway card whose skills are the reachable ships. The A2A study rejected this: an A2A message names no skill, so it cannot route.

Pick 1.

**A5. One switch, or one per protocol.** Interop 3.1 said "each adapter is switched on per fleet". 0056 and the gateway have one switch for outside parties.
1. **The one switch** covers MCP and A2A.
2. A switch per protocol.

Pick 1. Approval already gates each party. A second switch is a gate nobody asked for.

**A6. Which capability an A2A message calls.** `waitMs`, `deadlineMs` and the output content type are per capability (0047). An A2A message names no skill.
1. **The first capability whose first input mode is the message's content type.** With none, there is no wait and no deadline, and rule 3.4's plain-text completion applies.
2. A skill id in `Message.metadata`. That is a key of our own, which a standard client never sets.

Pick 1. Standard clients send only standard fields.

**A7. Content type of an inbound A2A message.**
1. **One text part travels as its text, with its `mediaType` (`text/plain` when none). One data part travels as JSON, with its `mediaType` (`application/json` when none). Anything else (several parts, `raw`, `url`) travels as the whole A2A message, `application/a2a+json`.**
2. Always `application/a2a+json`.

Pick 1. A ship that knows nothing of A2A still gets plain text, as the A2A study proposed.

**A8. CancelTask.**
1. **Always answer `TaskNotCancelableError`.**
2. Send the ship a cancel request and report its answer.

Pick 1. Aeolus cannot withdraw a sent message, and 2 needs a content type of our own.

**A9. Who marks an outside agent not repeatable.** I-7 says "argo's mark". 0053 and 0057 make no job argo's alone.
1. **Any actor holding `gateway:approve`**, on the party's detail, as MCP tool marks are set today.
2. argo only.

Pick 1.

**A10. AUTH_REQUIRED from an outside agent.**
1. **A reply to the sender carrying the state, then `handled`.** The proxy ship's owner fixes the credential on the gateway's page.
2. The gateway asks the owner (0038) and holds the task.

Pick 1 for 0.30.0. Credentials stay in the vault (study question 6), and nothing waits on a human by default.

**A11. Build on `@a2a-js/sdk`, or write the bindings.**
1. **The SDK behind the gateway's ports.** Its request handler and client are used, with the call store in place of its task store. Pinned. Slice 2 checks that it answers only after `send` is OK.
2. Write JSON-RPC, HTTP+JSON and SSE ourselves on Fastify.

Pick 1. Spec drift lands in one dependency, and the SDK already serves both verbs of SubscribeToTask.

## 5. Slices for 0.30.0

A2A in before out. Each slice is gateway work unless it says core. Each ends usable and green, and the acceptance criteria follow the picks.

| # | Slice | Acceptance criteria |
| --- | --- | --- |
| 0 | **Docs (core repo).** Outside party covers A2A (A1). The gateway's row in `compatibility.md` gains `receiveReply`, `sentMessage` and `delivery` | 0050, 0056 and the blueprint say MCP or A2A. No other decision changes |
| 1 | **A2A in: admit a client, cards** | An approver adds an A2A client: an `a2a-client` proxy ship is commissioned with the owner and scopes chosen, and a bearer is shown once. With the switch off, no add. The public card per alias carries no skills (A3). `GetExtendedAgentCard` answers the statement for a reachable alias and an unknown-alias error for an unreachable one. The party's detail lists card addresses (A4) |
| 2 | **A2A in: SendMessage, GetTask, ListTasks, CancelTask** over JSON-RPC and HTTP+JSON | The answer comes only after `send` OK (a test with core refusing and core down). The same `messageId` gives one `msg_`. The task id is an HMAC of `msg_`. States follow rule 3.4 from `sentMessage` and `receiveReply`. Content types follow A7. `waitMs` and `return_immediately` are honoured (A6). FAILED comes from the deadline or a failed delivery. `taskId` continues with `inReplyTo`. Over 64 KB, or without `A2A-Version: 1.0`, gives an A2A error. CancelTask gives `TaskNotCancelableError`. ListTasks shows only the caller's own. `a2a-tck` 1.0 mandatory tests pass for these methods. If blocking with `waitMs` 0 fails the kit, the wait is the gateway's cap (I-9's open risk) |
| 3 | **A2A in: streaming** | `SendStreamingMessage` and `SubscribeToTask`, on GET and POST, send the stored task first and close at a terminal state. A dropped stream loses nothing on resubscribe. Subscribing to a terminal task gives the spec's error |
| 4 | **A2A in: push to the client's webhook** | The push config calls on the proto's shape. Each change is POSTed with retries and backoff, then given up. GetTask still answers. The webhook gets no payload of a call that is not the client's |
| 5 | **A2A out: add an agent** | An approver adds an agent by its card address. The gateway reads the card first; an invalid card is not added. An `a2a-agent` proxy ship is commissioned. Its statement carries the skills, without interfaces, schemes or signatures, and every capability is `repeatable` unless marked (A9). The verified fact is `a2aCardDomain`. The credential is a bearer or client credentials in the vault |
| 6 | **A2A out: hand over and follow** | As in flow 3.2: `pushReceive`, `handed` with channel `a2a`, a stable `messageId`, an ack only on an accepting answer, following by `SubscribeToTask` when the card states streaming and by `GetTask` otherwise, each status or artifact as a reply with a derived key (a restart sends no duplicate), and `handled` at a terminal state. The concurrency limit holds. Not repeatable gives `notHandled` with the reason. INPUT_REQUIRED continues through a reply. AUTH_REQUIRED follows A10. A task gone gives `notHandled` |

After 0.30.0: push from outside agents to the gateway's webhook, OAuth client credentials for A2A clients (A2 option 3), and A2A 1.1 once it is released.
