# Level 3 interop: outside MCP and A2A parties in the fleet

Design by designer-3. Thomas: "the end state is level 3 for all", wanted soon.

This design builds on these inputs, each on its own branch:

| Input | Branch and file |
| --- | --- |
| The MCP study | `design/interop-mcp`, `docs/design/interop-mcp/interop-mcp.md` |
| The A2A study (designer-4), with the NAT correction | `design/interop-a2a`, `docs/design/interop-a2a/interop-a2a.md` |
| Scope rework part 0, with the decisions of 17 Oct (0.A to 0.C) | `design/scope-rework`, `docs/design/scope-rework/scope-rework.md` |
| The gateway architecture Thomas reviewed on 17 Oct | One or two gateways beside core, a proxy ship per outside party, gateways that translate and hold outside credentials, and policy that stays in core |

Specs:

| Spec | Version | Notes |
| --- | --- | --- |
| MCP | 2026-07-28 | Tasks is an extension (`io.modelcontextprotocol/tasks`) |
| A2A | 1.0 | v1.0.1 tagged; the proto is normative where the text disagrees |

This design takes no decisions; the options and picks are in part 4.

## 1. Purpose

Any company's existing agents, MCP clients and MCP servers join one organisation's fleet without an Aeolus client. Network rules govern them as they govern any ship, and the stored-before-OK promise covers their messages.

**Level 3 for all** means four directions:

| Direction | What happens |
| --- | --- |
| MCP out | An outside MCP server, such as the company's CRM, becomes an app ship. Fleet ships call its tools by sending it messages |
| MCP in | An outside MCP client, such as Claude, ChatGPT or Cursor, connects to one fleet URL. It sees the capabilities of the ships its party reaches as tools, and calls them |
| A2A out | An outside A2A agent becomes a ship. Fleet ships send it messages, and its task results come back as replies |
| A2A in | An outside A2A agent reads an agent card per reachable fleet ship and talks to that ship over A2A |

**A good outcome, in the scenario of scope-rework 0.1:**

- Thomas's and Charlotte's ships call the CRM through the fleet; Burak's cannot. No session holds the CRM's credential.
- Charlotte's PRD work runs from her own Claude, signed in with the company's SSO, with no crew token in her chat.
- A supplier's A2A agent reaches the procurement ship and nothing else. It sees one gateway URL and an opaque alias, never a ship name.
- Every one of these parties is a ship with an owner, so a human answers for it (0.C).

## 2. Lessons to check against

Each line is a check the design below must pass.

| Lesson | Source |
| --- | --- |
| **Every caller is a ship.** Each outside party gets its own proxy ship, never a shared gateway ship. A shared ship would put every outside caller under one reach | 0012, 0.4, both studies |
| **Policy stays in core. The network decides every interaction** (send, read, manage). The gateway decides no reach of its own: it shows and allows exactly what core answers for the proxy ship | 0.B, 0034 |
| **No rights travel with a message.** An outside party's OAuth scopes never become fleet scopes. The proxy ship's scopes are argo's, set at commission. The outside server sees the gateway's credential, never the asker's (MCP forbids token passthrough) | 0002, decision of 17 Oct, MCP authorization |
| **Aeolus distributes, it does not execute.** The task lifecycle (which reply completes, when a task fails) lives in the gateway. Core never reads a payload | 0001, 0016, both studies |
| **Stored before OK.** The gateway answers an outside call only after the fleet's `send` answered OK. It never buffers, and never answers OK itself | 0003, 0.8 question 42 |
| **Idempotency needs a key.** A2A's `messageId` gives one. MCP has none, and a client resends with a new JSON-RPC id after a broken stream | MCP study |
| **NAT both ways.** Outside sees the gateway endpoint, an opaque alias per ship, and opaque ids (an HMAC of the `msg_` id). Inside sees the proxy ship by name, type and labels, never the outside URL or credential | A2A study |
| **Contained access.** The gateway holds the proxy ships' crew tokens and the outside credentials, as the trierarch holds its sessions' tokens. No outside party holds a crew token | 0.8 |
| **The fleet never speaks for a ship.** A gateway may speak only as the proxy ships it crews | 0040 |
| **A statement is a claim.** Core stores it and vouches for nothing in it | 0.9 |
| **Payloads are at most 64 KB**, and travel as references beyond that | 0006 |
| **Every ship has an owner, a human.** A proxy ship's owner is the person inside who answers for that outside party | 0.C, 0.10 |
| **Core is the server, its API and argo's console.** A plugin serves its own pages | 0.A, question 30 |
| **One version for every published package.** Separate packages do not give separate release cycles unless 0011 changes | 0011 |
| **Both specs move fast.** MCP has had four revisions in 18 months; 2026-07-28 removed sessions and moved Tasks into an extension. A2A went from 0.3 to 1.0, and its text and proto disagree today | Both studies |

## 3. Design

### 3.1 One gateway, two adapters

**Pick: one package and process, `@aeolus-fleet/gateway`,** with an MCP adapter and an A2A adapter. Each adapter is switched on per fleet. It sits beside core like squadrons: an optional package, its own small database, reaching the fleet only through the public API as a ship of each fleet it serves (0017, 0021).

**Shared parts.** They are most of the work:

| Shared part | Does |
| --- | --- |
| Outside identity | One OAuth 2.1 authorization server for both protocols: CIMD and pre-registered clients, RFC 9728 protected resource metadata, and RFC 8707 audience binding. Static bearers for machine parties. Later, federation to the company IdP. One party may speak both protocols (an agent with an MCP client and an A2A card); it is one party, with one proxy ship |
| Proxy ship crew | Holds each proxy ship's crew token, runs its receive loop, acks, and takes the reply to one message (part 3.5) |
| Credential vault | Holds the credentials the gateway uses to call outside MCP servers and A2A agents |
| Alias table and opaque ids | Gives each exposed ship an alias, and each id the outside sees an HMAC under the gateway's own key. It never serves a ship name |
| Call store | One record per outside request: the request message, the alias, the caller, its state, its deadline, and the completing reply. MCP tasks and A2A tasks are two views of it (question 3) |
| Waking outside parties | Gap 4.1 |
| Health and admin UI | Its own page (question 30): parties, credentials, aliases, calls stuck in the gateway |

**Per adapter:**

| MCP adapter | A2A adapter |
| --- | --- |
| Streamable HTTP server: `tools/list`, `tools/call` and the Tasks extension | JSON-RPC and HTTP+JSON bindings |
| MCP client for MCP out | Cards: a public card per alias, an extended card per caller |
| | Streams and push webhooks |
| | A2A client for A2A out |

**Why one gateway and not two:**

- **Shared work.** The shared parts are the hard and security-sensitive part. Two gateways would build them twice, or extract a third shared package.
- **One identity per party.** Two OAuth servers would issue two identities to the same party.
- **No release gain.** The reason for two was separate release cycles. 0011 already releases every package at one version, so two packages would not release apart without changing 0011.
- **Spec drift stays local.** A spec move touches one adapter folder behind a port, and the hosting service switches an adapter off per fleet while it lags.
- **Stays decided:** core's `/mcp` keeps serving the ship contract with the crew token as an argument. The gateway serves at its own path (`/gw/mcp`, `/gw/a2a/<alias>`).

### 3.2 Proxy ships

Each outside party is a ship, of kind app or person (decisions of 17 Oct):

| Outside party | Kind | Direction | Statement |
| --- | --- | --- | --- |
| An outside MCP server (the CRM) | app | MCP out | Written by the gateway from the server's `tools/list` (MCP tool fields, 0.9) |
| An outside A2A agent | app | A2A out | Written by the gateway from the agent's card skills, without interfaces, security schemes or signatures |
| An outside MCP client or A2A client of a company app | app | MCP in, A2A in | None needed |
| A person's MCP client (Charlotte's Claude) signing in through the gateway | person | MCP in | The person's own |

- **Commission.** argo commissions each proxy ship and connects it to the gateway (question 5). The commission sets its owner, its labels and `messages:send` and `messages:receive` only.
- **Crew.** The gateway crews every proxy ship as long as the party is connected.
- **Proxy calls.** Every call the gateway makes for a party is that proxy ship's call: send, discovery and reading by its reach. Core checks it as it checks any ship.

### 3.3 The four directions

**MCP out:**

1. A fleet ship sends a message to the CRM ship, of the content type the capability states, with the tool arguments as its JSON payload.
2. The gateway receives it, acks it (0001), and calls `tools/call` with the vault's credential.
3. It sends the result back as a reply naming the request (`inReplyTo`). It reports `handled`, or `notHandled` when the call failed (0040), so Health shows a failure.
4. A crash between the ack and the call loses the call: the outside call runs at most once (MCP study, question 13).

**MCP in:**

1. The client authorizes with OAuth. The token names the party, and so its proxy ship.
2. `tools/list` is discovery for that ship, mapped to tools named `<alias>__<capability>`.
3. `tools/call` sends the request, then waits a bounded time for the completing reply (part 3.4).
   - With the Tasks extension, the answer is a task, durably created before the answer.
   - Without it, the answer is a handle, collected with a result tool.
4. An optional idempotency argument, also mirrored to an `x-mcp-header`, becomes the send's key.
5. For a person's proxy ship, the gateway also serves the person's own ship calls (inbox, receive, answer) behind OAuth. The chat then holds no crew token, which is 0.8's containment for chats.

**A2A in.** As the A2A study's direction A, through the shared parts:

- The client's `messageId` is the idempotency key.
- The task id is an HMAC of the request's `msg_` id.
- The task state comes from the delivery states and the completing reply.

**A2A out.** As the A2A study's direction B:

- The gateway acks the fleet delivery only once the outside agent accepted it, so the call runs at least once, with a stable `messageId`.
- Each outside status or artifact goes back as a durable reply, with a key derived from the outside task and event.

### 3.4 Which reply completes, and when a call fails (both protocols)

One rule in the call store. Replies here are replies from the called ship naming the request.

| Call state | When | MCP | A2A |
| --- | --- | --- | --- |
| submitted | stored; delivery pending, received or handed | task `working` | `SUBMITTED` |
| working | delivery acknowledged or handled; no completing reply yet; earlier replies of other content types become status messages | task `working` | `WORKING`, with status messages |
| input needed | a reply of the question content type (0038's shape, sent to the asker) | `input_required`, later work | `INPUT_REQUIRED` |
| completed | the first reply of the capability's stated output content type. A reply of `application/a2a+json` drives the state it carries. Plain text from a ship that stated no output type completes it | `completed` | `COMPLETED`, or the state carried |
| failed | delivery undeliverable, not handled, dismissed or abandoned; or the deadline passed | `failed` | `FAILED` |

- **The deadline** is stated per capability by the ship, with a gateway default. Only the gateway uses it.
- **A reply after failed** is acked and kept on the call's history; it does not change the state.
- **Core keeps no state.** The fleet message and its deliveries stay exactly as core keeps them; the failed state is the gateway's.

### 3.5 Core changes, and where everything else lives

**Core gains two ship procedures.** Both stay within identity: a ship's own messages.

| Procedure | Does | Why |
| --- | --- | --- |
| Receive a reply to one message (`receiveReply`, with a message id) | Claims, for the calling crew, the oldest pending delivery whose message names that message as `inReplyTo`. Same states, attempts and ack as `receive`; waits briefly, as `receive` does | A proxy ship with many open calls must take the reply that completes this one. `receive` hands the oldest delivery first |
| A sender reads its delivery states (`sentMessage`, with a message id) | For a message the caller sent: each delivery's state and since when, and the recipient as the caller may see it under read reach. No payload but its own | Submitted versus working, and failed, come from these states. Today only `fleet:read` sees them, and it reads every payload (0.2) |

**Core gains nothing protocol-specific.** The parts below come from the scope rework, and level 3 needs them first:

- the statement with MCP's tool fields and discovery (0.9);
- kinds and owners (0.C);
- read reach (0.B).

**Everything else lives in the gateway:**

- the OAuth server and federation;
- the vault;
- the aliases;
- the call store;
- the adapters;
- waking outside parties;
- the gateway's own UI.

The networking plugin is unchanged: proxy ships are ships with labels.

### 3.6 Slice order toward level 3 for all

Each slice ends usable. The sizes are rough, in slices of the build plan's size.

| # | Slice | What a customer gets | Size |
| --- | --- | --- | --- |
| P | **Prerequisites in core:** statement and discovery (0.9), kinds and owner (0.C), `receiveReply`, `sentMessage` | Ships say what they offer; owners answer for ships | 5 to 7 (statement and discovery 2 to 3, owner and kinds 2, each core procedure 1) |
| 1 | **Gateway skeleton and MCP out:** package and per-fleet connection, proxy ship crew, vault (static bearer and client credentials), statement from `tools/list`, call by message, handled and not handled | The company's existing MCP servers become app ships, gated by network rules. Sessions drop their own CRM credentials | 3 |
| 2 | **MCP in, synchronous:** OAuth server (CIMD, pre-registered clients, RFC 9728 and RFC 8707), proxy ship per party, aliases, `tools/list` from discovery, `tools/call` with a bounded wait and a result handle, idempotency argument | Claude, ChatGPT and Cursor call fleet app ships from one URL, signed in, within reach | 4 to 5 |
| 3 | **MCP in, long calls and people:** Tasks extension on the call store, a person's ship calls behind OAuth, waking (4.1) | Long agent work as MCP tasks; a person works their own ship from their chat without a crew token and is told when a go waits | 2 to 3 |
| 4 | **A2A in:** cards per alias and the extended card, JSON-RPC and HTTP+JSON, call store as tasks, streams, push webhooks | Any A2A agent talks to fleet ships with no Aeolus client | 4 to 5 |
| 5 | **A2A out:** proxy ship per outside agent, card to statement, follow outside tasks, results as replies | Fleet ships work with outside A2A agents as if they were ships | 3 |
| 6 | **Federation:** SSO through the company IdP (enterprise-managed authorization, ID-JAG) for people; verified outside identities in discovery (4.4) | People sign in with company accounts; ships see which parties are verified | 2 to 3 |

**Total:** 18 to 22 gateway slices, after the 5 to 7 slices of prerequisites. Upkeep is about one gateway slice per MCP revision and one per A2A minor version.

What could run in parallel: slice 1 needs only the statement and owner from P, so P's two core procedures can be built alongside slice 1.

## 4. Questions for Thomas

### Gaps from 17 Oct

1. **How does a person's tool learn that a request for their go waits, when MCP cannot push?** MCP 2026-07-28 has no server-initiated requests and no GET stream. `subscriptions/listen` streams list and resource changes only while the client holds the stream, and no client wakes a model on them.
   - Options:
     - (a) the gateway, as crew of the person's proxy ship, wakes the person through a channel their owner configures (email, web push, or a chat tool's incoming webhook), with no content, only "a request waits" and a link; the person then pulls in their MCP client;
     - (b) the person's inbox as an MCP resource, updated on `subscriptions/listen`, for clients that hold the stream;
     - (c) pull only: the person's tool checks the inbox when a chat opens;
     - (d) the fleet tells the person by message.
   - Pick: (a), plus (b) where a client supports it. It mirrors the trierarch waking a session. It is the proxy ship's crew acting, not the fleet speaking (0040), and no content leaves the fleet. (c) leaves a go waiting until someone happens to look. (d) has nothing to deliver to: the person's own ship is the inbox.
2. **Which reply completes an A2A task (and an MCP call), and when does one fail?**
   - Options:
     - (a) the rule in 3.4: the stated output content type completes, `application/a2a+json` drives the state it carries, a question means input needed, and delivery failure or the stated deadline means failed;
     - (b) only `application/a2a+json` replies drive state, and plain text is a final message;
     - (c) the first reply completes, and there is no deadline.
   - Pick: (a). One rule for both protocols. A ship that knows nothing of A2A still works through its statement, and a ship that never answers ends `failed`, not working forever.
3. **Outside callers when no networking plugin is connected.** No plugin means all-to-all (0035): every outside party would reach, read and discover every ship.
   - Options:
     - (a) leave it: the operator's call (0016), with a warning on the gateway's page;
     - (b) the gateway does not switch on for a fleet without a registered networking plugin;
     - (c) the gateway declares rules for its proxy ships (0037), which are in force only with a plugin anyway;
     - (d) core keeps proxy ships at "the fixed exceptions only" while no plugin is registered.
   - Pick: (b). It is a precondition on connecting a plugin, not a rule core applies to sends, so core stays free of policy. It needs Thomas to say whether that is a protective rule under 0016. (d) puts a kind-based rule into core, against 0034's labels-only reach.
4. **Federation, and verified against stated in discovery.**
   - People: SSO for the person's MCP client and app.
     - Options: (a) the gateway's OAuth server federates to the company IdP (OIDC, or MCP's enterprise-managed authorization with ID-JAG), mapping the IdP subject to the person's ship, by argo's mapping; (b) the gateway's own accounts; (c) the crew token in the chat, as today.
     - Pick: (a). People log in as they log in to everything else, and leavers lose access when the IdP drops them. (b) is a second user directory, and (c) is what 0.8 removes.
   - Outside parties: a verified identity.
     - Options: (a) the gateway records what it verified for each proxy ship (the OAuth issuer and subject, the mTLS certificate subject, or the domain a card was fetched from), and discovery shows it beside the statement, marked verified by the gateway, while the statement stays marked stated by the crew; (b) statements only; (c) the gateway signs A2A cards.
     - Pick: (a). A reader weighs a claim against what was checked. Core stores the verified facts as the gateway wrote them, as it stores any statement, and the owner (0.C) answers for both. (c) has the fleet vouch for content, which 0.9 declined.

### The design's own

5. **Who commissions proxy ships?**
   - Options: (a) argo, in the console, then connects them in the gateway's page; (b) the gateway, with `fleet:commission`, when argo approves a party in the gateway's page, the owner named there (question 63); (c) self-service on first OAuth sign-in.
   - Pick: (b). argo still decides each party, in one place, and the gateway sets the owner, labels and scopes in one step. (c) lets outsiders create ships.
6. **One gateway or two?**
   - Options: (a) one, with two adapters; (b) two packages.
   - Pick: (a), for 3.1's reasons. It changes 0008 by one package either way.
7. **MCP out: at most once.**
   - Options: (a) ack on receipt, then call, with `notHandled` on failure; (b) ack after the call returns.
   - Pick: (a). 0001 stands. A2A out is at least once only because A2A gives a stable `messageId` to dedupe on; MCP gives none.
8. **Many proxy ships, one gateway.** Each crewed ship waits on its own `inbox` call, as trierarch watchers do.
   - Options: (a) one waiting `inbox` per proxy ship; (b) a core call that waits on the inboxes of every ship the caller crews.
   - Pick: (a) until a fleet has hundreds of parties. (b) is a core change to justify with numbers.
9. **The A2A blocking default and the MCP synchronous wait.**
   - Options: (a) one bounded wait in the gateway's configuration, then the task or handle; (b) always answer at once.
   - Pick: (a). Short app calls complete in one round trip.
