# MCP interoperability: level 2 and level 3

Design study by designer-3. It takes no decisions; options and picks are only in part 5. It builds on part 0 of the scope rework (branch `design/scope-rework`, `docs/design/scope-rework/scope-rework.md`): an app as a ship (question 25), contained fleet access (0.8), discovery and what a ship states (0.9, questions 47 to 55). The three levels are question 55's: (a) borrow the shapes, (b) speak the formats, (c) speak the protocols. This study covers MCP only. A2A comes up only where it changes an MCP answer.

## Sources (read 17 Oct 2026)

The current MCP release is **2026-07-28**. The draft changelog lists no changes since then.

- **Specification 2026-07-28** (https://modelcontextprotocol.io/specification/2026-07-28/), pages read:
  - `changelog`, `versioning`, `deprecated`, `basic/versioning`;
  - `basic/transports/streamable-http`, `basic/transports/stdio`;
  - `basic/patterns/mrtr`, `subscriptions`, `cancellation`, `progress`;
  - `server/discover`, `server/tools`, `server/resources`, `client/elicitation`;
  - `basic/authorization/index`, `basic/authorization/client-registration`.
- **Extensions:**
  - `/extensions/overview` (SEP-2133);
  - `/extensions/tasks/overview`, with https://github.com/modelcontextprotocol/ext-tasks (`specification/2026-07-28/tasks.md`, `schema/2026-07-28/schema.ts`; SEP-2663, stable for 2026-07-28);
  - `/extensions/auth/enterprise-managed-authorization` (SEP-990).
- **2025-11-25:** `/specification/2025-11-25/basic/utilities/tasks`, where Tasks were experimental core.
- **Roadmap and community:** `/development/roadmap` (updated 2026-08-22), `/registry/about`, `/community/working-groups/server-card`, `/community/working-groups/agents`.
- **Blog:** https://blog.modelcontextprotocol.io/posts/2026-07-28/.

The scope rework calls the server cards SEP-2127 "final as an extension". The server-card working group page still lists it as Draft, with an experimental repo, and the roadmap says `.well-known` conventions are still being worked through. This study treats server cards as not yet standard.

What 2026-07-28 changed that matters here:

- **No sessions.** The `initialize` handshake is gone. Every request carries its protocol version, client capabilities and client info in `_meta`. `server/discover` answers versions, capabilities and instructions.
- **Streamable HTTP is POST only.** One SSE stream per request, no GET stream, no `Mcp-Session-Id` and no `Last-Event-ID` resume. A broken stream loses the call, and the client sends it again with a new JSON-RPC id.
- **Server requests replaced.** Multi round-trip requests (MRTR: `resultType: "input_required"`) replace server-to-client requests. Sampling, roots and logging are deprecated.
- **Tasks are an extension.** Tasks moved out of core into `io.modelcontextprotocol/tasks`. `tasks/list` and `tasks/result` are removed.
- **New client registration rules.** Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents.

## What exists today

`/mcp` (`packages/core/src/adapters/mcp/mcp-endpoint.ts`, decisions 0004 and 0015) is a stateless streamable HTTP MCP server built on the official SDK.

- **Its tools are the ship contract:** `register`, `send`, `receive`, `ack` and the rest, plus `fleet_*` for ships with fleet scopes.
- **Its instructions are the ship protocol.**
- **Identity is a tool argument.** Every tool but `register` takes `crewToken` as an argument. No connection header is ever a credential, and there is no OAuth.

So any MCP client can already **crew a ship**: it registers, sends messages and receives them. It talks *Aeolus over MCP*. It does not see a CRM ship's capabilities as tools, and an MCP server outside the fleet is not reachable through the fleet at all. A session's own MCP tools are outside every network rule (scope rework 0.3, last row).

## 1. What level 3 means for MCP

Level 3 has two directions. Both put the fleet between the caller and the callee, so scopes and network rules apply to the call.

**In: an outside MCP client calls a fleet ship.**

- **Who connects:** Claude, ChatGPT, Cursor or a company's own agent, configured with one fleet MCP URL.
- **It connects to:** a gateway MCP server. The gateway's `tools/list` answers the capabilities that the app ships this client may reach have stated (0.9).
- **A call:**
  1. `tools/call` on `crm.find_customer` becomes a durable message from the client's ship to the CRM ship, of the content type the capability states, with the arguments as payload.
  2. The CRM ship's reply (`inReplyTo`) becomes the call's result.
  3. If the reply is not back before the HTTP call has to end, the result comes later as an MCP task.
- **The callee:** a fleet ship crewed by an agent session or by an app's adapter. It needs nothing MCP-specific. It receives a message and answers it, as today.

**Out: a fleet ship calls an outside MCP server or agent.**

- **Who connects:** the gateway, acting as an MCP client of an outside MCP server: the company's existing CRM MCP server, a SaaS vendor's server, or an agent exposed as an MCP server.
- **How the server joins the fleet:** it is an app ship (question 25 (a)), crewed by the gateway.
  - The ship's statement is the outside server's `tools/list`, read from that server.
  - A message to the ship becomes a `tools/call` on the outside server, and its result becomes the reply.
- **The caller:** any fleet ship that may reach the app ship under the network rules. It sends an ordinary message. It holds no credential for the outside server; the gateway holds it.

This is the cheaper direction, and it fits Aeolus's model best: an app ship is just a ship that answers messages. It is also what makes the CRM scenario enforceable (0.1: "Burak's ships cannot get at the CRM"). Today a session reaches the CRM through its own tools, where no rule applies.

## 2. The mapping

Fit: **clean**, **gap** (maps, with the gap named), **none** (does not map).

| MCP concept (2026-07-28) | Aeolus counterpart | Fit | Gap |
| --- | --- | --- | --- |
| Server | In: the gateway, standing for the app ships a caller reaches. Out: the outside server, behind one app ship | gap | MCP has one server per endpoint. In: either one aggregated server per fleet or one per ship (question 9) |
| Client | In: the outside client, as a ship of its own. Out: the gateway, crewing the app ship | gap | Every caller is a ship (0012), so every outside client needs a ship, its commission, labels and a crew held by the gateway (question 2) |
| `server/discover`: info, instructions, capabilities | The fleet's server info. Instructions: a short text on how calls behave (async, tasks) | clean | |
| `tools/list` | Discovery (0.9): capabilities stated by the ships the caller reaches | gap | Lists MUST carry `ttlMs` and `cacheScope` and may vary by authorization, so reach can filter them. A tool name SHOULD use `[A-Za-z0-9_.-]`, but ship names allow `:`, so names need mapping (question 10) |
| `tools/call` | `send` to the ship, then waiting for the reply naming it | gap | MCP is request and response; a ship answers when it does, or never (0001). The fleet must say which reply completes the call (question 4). MCP has no idempotency key, and a call resent after a broken stream gets a new id, so it becomes a second message (question 7) |
| `inputSchema` (JSON Schema, 2020-12 by default) | The capability's payload schema (0.9, question 48 (a)) | clean | It needs question 54 (a), a shape checked at write, so the schema is valid JSON Schema |
| `outputSchema`, `structuredContent` | The reply's payload schema and the reply's JSON payload | clean | The reply is up to 64 KB of text with a content type. A non-JSON reply goes into `content` as text |
| `content` (text, `resource_link`) | The reply payload. A reference (0006) becomes a `resource_link` | gap | The gateway does not fetch the reference; the client does |
| `isError` | A reply of an error content type stated by the capability | gap | Aeolus has no error convention for replies; the statement must name one |
| Tasks extension: `CreateTaskResult`, `tasks/get`, `tasks/update`, `tasks/cancel` | The sent message and its delivery. The task id is the message id | gap | Durable before the response: MCP requires the task "durably created", which Aeolus's send already is. The rest is spelled out after this table |
| Task states: `working`, `input_required`, `completed`, `failed`, `cancelled` | Delivery states and the reply | gap | Spelled out after this table |
| Task TTL (`ttlMs`) | None: messages live forever | gap | The gateway picks a TTL, per capability or fleet-wide (question 5) |
| MRTR (`input_required`) and elicitation | A question from the called ship back to its asker (0038's shape, sent to the asker) | gap | A reply of the question content type could become `input_required` with a form elicitation, and the answer a reply. This is follow-up work (question 11) |
| Resources (`resources/list`, `read`) | Statements, and references in payloads | gap | A ship's statement could be a resource. Aeolus content lives behind references the fleet never reads (0006), so the gateway serves no content itself |
| Prompts | None | none | Nothing in Aeolus is a prompt template. A starting prompt is a credential, never served this way |
| Sampling, roots, logging | None | none | Deprecated in 2026-07-28. The fleet never calls a model |
| Notifications: `subscriptions/listen` with `toolsListChanged` | A statement's version change. `fleet.follow` already streams events | gap | Needs a per-caller stream, filtered by reach. Missed notifications are not replayed (MCP), which suits the fleet: the client asks `tools/list` again |
| `notifications/tasks` (optional push) | `NOTIFY` on the reply's arrival | gap | Optional in MCP. Polling `tasks/get` is enough first |
| Progress (`notifications/progress`) | The called ship's report note | none | A report belongs to the lease, not to a message (0028), and progress flows only on the call's own stream |
| Cancellation (stream close, `tasks/cancel`) | None: a stored message is delivered whatever happens later (0034) | gap | Closing the stream ends only the wait, never the message. `tasks/cancel` is cooperative in MCP, so the gateway may leave the task working (question 12) |
| Streamable HTTP, stateless POST | `/mcp` already, stateless | clean | |
| stdio | None | none | The fleet is remote. A local client uses the HTTP URL |
| Sessions | None in 2026-07-28. In Aeolus, a lease is not a connection | clean | The 2026 removal of sessions fits Aeolus better than 2025 did: identity per request, as with the crew token. The SDK's fallback still answers 2025-era clients |
| Authorization: OAuth 2.1, RFC 9728 protected resource metadata, RFC 8707 audience, CIMD | The crew token as a tool argument (0015). No OAuth | gap | The largest gap; part 3 covers it. 0015 rejected "OAuth per connector" for crewing ships, and level 3's in direction needs OAuth for outside callers |
| OAuth scopes, `insufficient_scope` step-up | Ship scopes, stored on the server (0002) | gap | OAuth scopes can only narrow, never grant. The ship's scopes decide, so a step-up never widens a ship |
| No token passthrough | Out: the gateway's own credential for the outside server | clean | The asker's identity never reaches the outside server, so it sees one caller, the gateway (part 3) |
| Registry (preview), server cards (draft) | Discovery (0.9), served only to ships | gap | Public listing would reveal ships to callers outside reach. At most one card per fleet naming the gateway URL, no ships |

**Task states against delivery states (in direction):**

| Task state | Aeolus state |
| --- | --- |
| `working` | message stored; its delivery pending, received, handed, acknowledged or handled, and no completing reply yet |
| `completed` | the completing reply has arrived |
| `failed` | the delivery is undeliverable, not handled, dismissed or abandoned; or the TTL ran out |
| `input_required` | a question came back from the called ship (follow-up work, question 11) |
| `cancelled` | none |

**Where the models differ:**

- **MCP assumes the server executes the call and owns its result.** Aeolus distributes: an ack means received, not done (0001), and nothing in core knows whether a ship will answer. The gateway must therefore follow work, from a send to the reply that completes it. That is the task lifecycle the scope rework says core does not do. It belongs beside core (part 3).
- **MCP lost-answer recovery.** It has no idempotency key, and after a broken stream it sends again with a new id. Aeolus has no exactly-once without a key. The task path limits the window to the one lost `CreateTaskResult`.
- **Most clients are synchronous.** I did not verify which mainstream MCP clients declare the Tasks extension today. Without it, the gateway may not return a task, and must answer within the client's HTTP timeout or hand back a handle as a plain tool result (MCP's "stateful tools" pattern, question 6).

## 3. What Aeolus would need to build

### Components and where they live

| Component | Where | Why there |
| --- | --- | --- |
| Statement shape: capability = MCP `Tool` fields plus content types (level 2) | `@aeolus-fleet/common` | One schema for every reader (question 54 (a)) |
| Statement store and discovery procedure | core, registry context (0.9) | Core stores and serves it and acts on none of it |
| Receive a reply to one message: claim the delivery that names a given message as `inReplyTo`, for the calling crew | core, messaging context, new ship procedure | Today `receive` answers the oldest deliveries first. A gateway holding many open calls for one client ship must take the reply that completes this call |
| MCP gateway, in and out | new optional package, `@aeolus-fleet/mcp-gateway`: its own process and small database, a ship of each fleet it serves, switched per fleet (0017, 0021, 0030 pattern) | Following work (task state, TTL, which reply completes) is not core's (0001, 0016). It holds the outside OAuth and the crew tokens of the ships it crews, as the trierarch would under 0.8. It needs a change to 0008 (packages), which is Thomas's |
| OAuth 2.1 authorization server, or federation to the company IdP | the gateway | Only outside callers need it. Core's crew token stays as it is |

Core's `/mcp` keeps serving the ship contract unchanged: two different things on two URLs. Folding capability tools into `/mcp` would mix the crew-token argument with OAuth bearers on one endpoint, and would put logic into an adapter, which 0004 forbids.

### Endpoints

- **Gateway MCP server:** `https://<fleet>/mcp/apps`, or the gateway's own host behind Caddy, streamable HTTP and stateless. It serves:
  - `server/discover`;
  - `tools/list`: the caller's reach, mapped to tools;
  - `tools/call`: send, wait briefly, then the result or a task;
  - with the Tasks extension: `tasks/get`, `tasks/update` (no-op until question 11) and `tasks/cancel` (question 12);
  - `subscriptions/listen` for `toolsListChanged`, later.
- **RFC 9728 metadata:** `/.well-known/oauth-protected-resource` for the gateway URL, naming its authorization server.
- **Authorization server:** RFC 8414 metadata, `/authorize`, `/token`. Client registration is CIMD, plus pre-registered clients. No DCR, since 2026-07-28 deprecates it.
- **Out direction:** no endpoint. The gateway is an MCP client of each outside server that argo configures: its URL and its credential (pre-registered OAuth client, client credentials, or the enterprise-managed authorization extension).

### Identity and auth mapping

**In direction:**

1. An OAuth access token, audience the gateway URL (RFC 8707), names a ship: the outside client's ship.
2. The gateway holds that ship's crew token, as the trierarch would under 0.8, and makes every fleet call as that ship.
3. The ship's scopes (`messages:send`, `messages:receive`, nothing else) and its labels are argo's, set at commission (0002, 0031).
4. OAuth consent can only pick a ship argo allowed for that user or client. It never grants a scope.

One ship per (client, user) keeps the network rules meaningful. One shared gateway ship would give every outside caller the same reach, which is exactly what containment must not do (0.4).

**Out direction:**

- The gateway crews the app ship and holds the outside server's credential. The outside server sees one caller.
- Who may use it is decided in the fleet, by who may send to the app ship.
- MCP's no-passthrough rule forbids forwarding the asker's token. Per-asker rights at the outside server need the server's own identity per caller, or token exchange (roadmap: RFC 8693, ID-JAG). Neither is in this design.

### How scopes and network rules still apply

- Every outside call is a fleet `send` from a fleet ship, so 0034 applies unchanged.
  - The send is checked at send time against both ships' labels.
  - A refusal is recorded for argo, and the caller gets `NOT_REACHABLE` (a tool error without reasons).
- `tools/list` shows only what discovery answers for the caller's ship, so a tool the caller cannot reach never shows. Its `cacheScope` must be per caller.
- argo labels outside-client ships (for example `origin=mcp`, `subfleet=charlotte`), and rules treat them like any ship.
- The fixed exceptions hold: every ship sends to argo, so an outside client could message argo. The gateway can offer argo as a tool or not (question 8).

### How the delivery guarantee holds, and where it cannot

| Step | Holds? |
| --- | --- |
| Request stored before the client hears OK | Yes. The gateway answers `CreateTaskResult` or a result only after `send` returned OK. That matches MCP's "MUST NOT return CreateTaskResult until the task is durably created" |
| Lost answer to `tools/call` | Only with a key. MCP resends with a new id, so without a client-supplied key it becomes a second message (question 7) |
| Reply reaches the client | Yes, by pull. The reply stays pending in the client ship's inbox until a `tasks/get` (or the handle tool) takes it. The gateway acks it only when it serves it, and serves it again from the stored message on a repeat. A client that never collects leaves a pending delivery, which Health shows (0042) |
| Gateway down | Yes. No answer, nothing stored, nothing buffered (0.8, question 42 (a)) |
| Out: message to app ship, then `tools/call` on the outside server | Only at most once for the call. The gateway acks on receipt (0001), then calls. A crash between the ack and the call loses the call, and a crash after it, before the reply, loses the result. 0040's `handled` and `notHandled` can say which, but the outside server's side effect is beyond the fleet (question 13) |
| Outside server's own semantics | No. The fleet carries the message; it cannot make an outside tool idempotent |

The promise ("no send returns OK before durably stored") holds in both directions. What cannot hold is exactly-once execution across a synchronous protocol without keys. That is no different from today, but customers will read "guaranteed communication" next to "MCP tool call" as more than it is.

## 4. Level 2 against level 3

**Level 2 alone** (for MCP):

- **What it is:** each app ship's capabilities are a valid MCP `Tool` list in its statement, readable by fleet ships and by argo's tooling.
- **What a customer gets:**
  - Shapes their developers already know.
  - Standard JSON Schema validation and codegen.
  - An adapter that wraps an existing MCP server can copy its `tools/list` into the statement unchanged.
- **What it does not give:**
  - No outside MCP client can call anything.
  - MCP has no standard static document for a tool list (server cards are a draft and carry no tools), so "served by the fleet" reaches no standard client.
- **Cost:** one or two slices (schema in common, the check at write, a read procedure), on top of 0.9's statement and discovery. Low upkeep: the `Tool` shape has been stable across the 2025 and 2026 revisions.

**Level 3** adds:

- **In:** a company points the MCP clients it already uses at one URL and calls fleet app ships as tools, under the fleet's reach and scopes, with durable requests and long calls as tasks.
- **Out:** a company's existing MCP servers become app ships without writing an adapter, gated by network rules instead of by whichever session has the server configured.

The out direction is the lower barrier to entry. The in direction is the selling point.

**Rough cost:**

| Part | Slices (rough) | Notes |
| --- | --- | --- |
| Out bridge: crew an app ship per outside MCP server, statement from its `tools/list`, message to call to reply | 2 to 3 | Gateway package skeleton, connection config, tests for crash between ack and call |
| Core: receive a reply to one message | 1 | Testcontainers concurrency test |
| In gateway: `tools/list` from discovery, `tools/call` with short wait and handle tool | 2 | |
| Tasks extension | 1 to 2 | |
| OAuth 2.1 server with CIMD, RFC 9728 and 8707, mapping a token to a ship | 2 to 3 | Security review, the largest risk |
| Idempotency key, TTL, failure mapping, Health entries | 1 to 2 | |

The total is about 9 to 13 slices, after 0.9's statement and discovery.

**Upkeep:**

- MCP has shipped four revisions in eighteen months (2025-03-26, 2025-06-18, 2025-11-25, 2026-07-28), and 2026-07-28 broke sessions, the GET stream and Tasks.
- The roadmap announces a redesigned `tools/call` result, Tasks moving back toward core, and new agent identity (DPoP, workload identity, token exchange).
- Expect one gateway slice per revision, plus SDK upgrades.
- OAuth hardening is ongoing work.
- Level 2's upkeep is a schema bump now and then.

## 5. Risks and open questions for Thomas

1. **Which direction first?**
   - Options: (a) out: outside MCP servers as app ships; (b) in: outside MCP clients calling fleet ships; (c) both together.
   - Pick: (a). It is the cheaper direction, it fits "a ship answers a message" with no task lifecycle, it needs no OAuth server, and it makes question 25's CRM gate real.
2. **How is an outside MCP client in the fleet?**
   - Options: (a) argo commissions a ship per client and user ahead of time, and OAuth consent binds to it; (b) the gateway commissions one on first sign-in (it needs `fleet:commission`), labelled `origin=mcp`, with no reach until argo labels it; (c) one shared gateway ship for all outside callers.
   - Pick: (a). Every caller stays a ship with argo's labels. (b) lowers the barrier but grants a plugin commissioning. (c) gives every outside caller one reach.
3. **Who issues the OAuth tokens?**
   - Options: (a) the gateway runs a minimal OAuth 2.1 authorization server (CIMD, pre-registered clients); (b) the company IdP, through the enterprise-managed authorization extension (ID-JAG), mapping the IdP subject to a ship; (c) no OAuth: a static bearer per ship pasted into the client.
   - Pick: (a) first, (b) for companies with an IdP later. (c) fits few clients and copies the crew-token risk 0.8 removes.
4. **Which reply completes a call?**
   - Options: (a) the first reply from the called ship naming the request; (b) the first such reply of the capability's stated output content type, earlier ones ignored; (c) a reply the ship marks final.
   - Pick: (b). It needs no new message field, and a ship can still send a question or a note first.
5. **When does a call fail?** Undeliverable, not handled, dismissed and abandoned map to `failed`. A ship that never answers is the open part.
   - Options: (a) a TTL per capability, stated by the ship, with a gateway default; (b) one TTL per fleet; (c) no TTL.
   - Pick: (a). The ship knows whether it answers in seconds or hours.
6. **Clients without the Tasks extension.**
   - Options: (a) wait up to a bound, then return a handle as a plain tool result and offer an `aeolus_result` tool to collect it; (b) refuse them; (c) hold the call until the reply.
   - Pick: (a). Most clients are synchronous today, and (c) dies on HTTP timeouts.
7. **Idempotency of `tools/call`.**
   - Options: (a) every gateway tool takes an optional idempotency key argument (also as an `x-mcp-header` parameter); (b) none: a lost answer may duplicate, as stated in the instructions; (c) dedupe by arguments within a window.
   - Pick: (a), and say plainly that without it a lost answer can mean a second message. (c) is guessing.
8. **Does the gateway offer argo or agent ships as tools, or only app ships?**
   - Options: (a) only ships whose statement states capabilities; (b) every reachable ship, with a generic "send a message" tool.
   - Pick: (a). An agent ship without a stated schema is a chat, not a tool.
9. **One server per fleet or per ship?**
   - Options: (a) one aggregated gateway URL per fleet, tools prefixed by ship; (b) one URL per app ship; (c) both.
   - Pick: (a). It is one connector for the customer; (b) can follow as a path filter.
10. **Tool names from ship names** (ship names allow `:`, MCP tool names SHOULD NOT).
    - Options: (a) `<ship>__<capability>` with `:` written as `.`, a collision refused at statement write; (b) the ship states its own tool prefix.
    - Pick: (a). It is deterministic, and no new field is needed.
11. **Questions back to the caller (`input_required`).**
    - Options: (a) a reply of the question content type becomes `input_required` with a form elicitation, and the answer becomes a reply; (b) not in the first version.
    - Pick: (b). Get the plain call right first.
12. **`tasks/cancel`.**
    - Options: (a) not supported: the task stays `working`, which MCP allows; (b) send the ship a cancel message of a fleet content type.
    - Pick: (a). (b) invents a convention core would teach.
13. **Out direction: the crash between ack and the outside call.**
    - Options: (a) accept at most once and report `handled` or `notHandled` (0040) so Health shows it; (b) ack only after the outside call returns, which reopens 0001 for this ship.
    - Pick: (a). 0001 stands, and the risk is named.
14. **Where the gateway lives.**
    - Options: (a) one new optional package `@aeolus-fleet/mcp-gateway` for both directions, a ship beside squadrons (changes 0008); (b) inside core's MCP adapter; (c) two packages, in and out.
    - Pick: (a). 0004 keeps logic out of adapters, and the task lifecycle is not core's.
15. **Which MCP revisions to support.**
    - Options: (a) the latest only, with the SDK's fallback for older clients; (b) the latest two, tested.
    - Pick: (a). Upkeep is already the largest running cost.
16. **Dependencies on the scope rework.** Level 2 and both level 3 directions need 0.9's statement (question 47), its shape checked in common (question 54 (a)), and discovery (questions 43 and 50). If question 55 is answered (a) now, the statement should use MCP's `Tool` field names exactly, so level 2 is a check and not a rewrite.
