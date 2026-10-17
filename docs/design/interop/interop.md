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

Thomas's decisions are recorded under Decided; parts 4 and 5 keep the options each one chose from.

### Decided (17 Oct)

| # | Decision | Thomas's words |
| --- | --- | --- |
| I-1 | **One wake pattern for every kind (5.1 (a)):** the crew's computer side hands over through its actor's channel, the lease states who wakes it, `handed` names the channel, and the owner sets what a channel may carry | "agreed with the pick" |
| I-2 | **Completion rule: (a)**, the rule in 3.4 | "agreed, might need changing later but we can only do that by trying it out." |
| I-3 | **The gateway does not switch on without a networking plugin** | "yes it is mandatory and even another reason to make it a part of core. But for now let's assume yes and we rework network later into core." |
| I-4 | **Federation for people through the company IdP; verified apart from stated for outside parties** | "indeed both" |
| I-5 | **(b): the gateway commissions proxy ships once argo approves a party** | "makes most sense gateway does it, since it knows about the outside parties." |
| I-6 | **One package** | "one package, we can always change later." Packaging and versioning are looked at separately, by another ship |
| I-7 | **MCP and A2A out true to 0040 (5.2 (a)):** hand again only where repeating is safe, otherwise not handled with "the call may have run"; A2A agents repeatable by default, argo's mark per proxy ship | "agreed with the pick" |
| I-8 | **(a): one waiting `inbox` call per proxy ship** | "indeed a". A core call that waits on many ships at once is not built until real numbers demand it, and then only as a deliberate identity design (a crew of many ships), never as a shortcut |
| I-9 | **Async by default (5.3 (c)):** an opt-in `waitMs` per capability in the statement, 0 by default, capped by the gateway's configuration | "ok agreed by adding the flexibility. Here you kept me true to my no policy unless it breaks the promise rule." |

No question is open.

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

**The deep dives would add three small changes to 0040 (5.1, 5.2):**

- the lease states who wakes it;
- `handed` names its channel;
- `notHandled` is accepted for a delivery handed and not confirmed whose crew judged it unsafe to hand again, with a reason.

The overdue clocks would also skip person ships (0.L).

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

1. **How does a person's tool learn that a request for their go waits, when MCP cannot push?** (I-1, decided: 5.1 (a)) MCP 2026-07-28 has no server-initiated requests and no GET stream. `subscriptions/listen` streams list and resource changes only while the client holds the stream, and no client wakes a model on them.
   - Options:
     - (a) the gateway, as crew of the person's proxy ship, wakes the person through a channel their owner configures (email, web push, or a chat tool's incoming webhook), with no content, only "a request waits" and a link; the person then pulls in their MCP client;
     - (b) the person's inbox as an MCP resource, updated on `subscriptions/listen`, for clients that hold the stream;
     - (c) pull only: the person's tool checks the inbox when a chat opens;
     - (d) the fleet tells the person by message.
   - Pick: (a), plus (b) where a client supports it. It mirrors the trierarch waking a session. It is the proxy ship's crew acting, not the fleet speaking (0040), and no content leaves the fleet. (c) leaves a go waiting until someone happens to look. (d) has nothing to deliver to: the person's own ship is the inbox.
2. **Which reply completes an A2A task (and an MCP call), and when does one fail?** (I-2, decided: (a))
   - Options:
     - (a) the rule in 3.4: the stated output content type completes, `application/a2a+json` drives the state it carries, a question means input needed, and delivery failure or the stated deadline means failed;
     - (b) only `application/a2a+json` replies drive state, and plain text is a final message;
     - (c) the first reply completes, and there is no deadline.
   - Pick: (a). One rule for both protocols. A ship that knows nothing of A2A still works through its statement, and a ship that never answers ends `failed`, not working forever.
3. **Outside callers when no networking plugin is connected.** (I-3, decided: (b)) No plugin means all-to-all (0035): every outside party would reach, read and discover every ship.
   - Options:
     - (a) leave it: the operator's call (0016), with a warning on the gateway's page;
     - (b) the gateway does not switch on for a fleet without a registered networking plugin;
     - (c) the gateway declares rules for its proxy ships (0037), which are in force only with a plugin anyway;
     - (d) core keeps proxy ships at "the fixed exceptions only" while no plugin is registered.
   - Pick: (b). It is a precondition on connecting a plugin, not a rule core applies to sends, so core stays free of policy. It needs Thomas to say whether that is a protective rule under 0016. (d) puts a kind-based rule into core, against 0034's labels-only reach.
4. **Federation, and verified against stated in discovery.** (I-4, decided: (a) for both)
   - People: SSO for the person's MCP client and app.
     - Options: (a) the gateway's OAuth server federates to the company IdP (OIDC, or MCP's enterprise-managed authorization with ID-JAG), mapping the IdP subject to the person's ship, by argo's mapping; (b) the gateway's own accounts; (c) the crew token in the chat, as today.
     - Pick: (a). People log in as they log in to everything else, and leavers lose access when the IdP drops them. (b) is a second user directory, and (c) is what 0.8 removes.
   - Outside parties: a verified identity.
     - Options: (a) the gateway records what it verified for each proxy ship (the OAuth issuer and subject, the mTLS certificate subject, or the domain a card was fetched from), and discovery shows it beside the statement, marked verified by the gateway, while the statement stays marked stated by the crew; (b) statements only; (c) the gateway signs A2A cards.
     - Pick: (a). A reader weighs a claim against what was checked. Core stores the verified facts as the gateway wrote them, as it stores any statement, and the owner (0.C) answers for both. (c) has the fleet vouch for content, which 0.9 declined.

### The design's own

5. **Who commissions proxy ships?** (I-5, decided: (b))
   - Options: (a) argo, in the console, then connects them in the gateway's page; (b) the gateway, with `fleet:commission`, when argo approves a party in the gateway's page, the owner named there (question 63); (c) self-service on first OAuth sign-in.
   - Pick: (b). argo still decides each party, in one place, and the gateway sets the owner, labels and scopes in one step. (c) lets outsiders create ships.
6. **One gateway or two?** (I-6, decided: (a))
   - Options: (a) one, with two adapters; (b) two packages.
   - Pick: (a), for 3.1's reasons. It changes 0008 by one package either way.
7. **MCP out: at most once.** (I-7, decided: 5.2 (a))
   - Options: (a) ack on receipt, then call, with `notHandled` on failure; (b) ack after the call returns.
   - Pick: (a). 0001 stands. A2A out is at least once only because A2A gives a stable `messageId` to dedupe on; MCP gives none.
8. **Many proxy ships, one gateway.** (I-8, decided: (a)) Each crewed ship waits on its own `inbox` call, as trierarch watchers do.
   - Options: (a) one waiting `inbox` per proxy ship; (b) a core call that waits on the inboxes of every ship the caller crews.
   - Pick: (a) until a fleet has hundreds of parties. (b) is a core change to justify with numbers.
9. **The A2A blocking default and the MCP synchronous wait.** (I-9, decided: 5.3 (c))
   - Options: (a) one bounded wait in the gateway's configuration, then the task or handle; (b) always answer at once.
   - Pick: (a). Short app calls complete in one round trip.

## 5. Deep dives

### 5.1 How any ship learns that something waits for it (I-1, zoomed out)

**Purpose.** Every ship, of every kind, learns that a delivery waits for it, with no human as the glue. The fleet's promises stay as they are:

- the promise ends at the actor's own confirmation (0001, 0040);
- the crew acts, and the fleet never speaks for a ship (0040);
- nothing is hidden (0.S).

Mathilde's go is one case of it.

**Today.** Every ship's crew has an *actor* (the model, a person, an app's code, an outside party) and, for most kinds, a *computer side* that stands between the fleet and the actor. Three mechanisms exist, all agent-only:

| Crew | Computer side | How it knows | How it reaches the actor | Confirmation | Visible in the fleet |
| --- | --- | --- | --- | --- | --- |
| Agent session a trierarch crews | the trierarch, with the aeolus plugin's `aeolus-push.sh` | waits on `inbox` | types the hand-over line into the idle session (tmux) | the hook's `ack` when the line's prompt starts | `LeasePushed`, `DeliveryReceived`, `DeliveryHanded` with its number, `TurnReported`, `DeliveryHandled`; the clocks |
| Agent session crewed by hand, aeolus plugin | the plugin's watcher (`aeolus-wait.sh`) and hooks | waits on `inbox` | finishes as a background task, which wakes the session; the hooks hand the message into the turn | the hook's `ack` | the same as above |
| Chat with the connector | none | the model calls `receive` when it runs | nothing: no process runs between turns | the model's `ack` | `DeliveryAcknowledged` only. Nothing shows that nobody will look until the person writes in the chat |

**What the new kinds need:**

| Kind | Actor | Computer side | The channel to the actor |
| --- | --- | --- | --- |
| Person ship (0.L: the person's app holds the lease) | the person | the person's app, or the gateway for a person's MCP client | a notification the person sees: mobile or web push, email, a chat tool's message |
| App ship, own adapter (the CRM's adapter) | the app's code | the adapter itself | none needed: a process waiting on `receive` is its own wake |
| Proxy ship of an outside MCP server or A2A agent | the outside party | the gateway | the protocol call itself: `tools/call`, `SendMessage` (5.2) |
| Proxy ship of an outside A2A client | the outside client | the gateway | A2A push notification to the client's webhook, or the client's open stream or `GetTask` |
| Proxy ship of an outside MCP client | the outside client | the gateway | while the client holds `subscriptions/listen`, a resource update; otherwise an outside channel the owner configures, as for a person |

**Options:**

- (a) **One pattern, the computer side's.** For every kind, the crew's computer side waits on `inbox`, push receives (0040), hands over through its actor's channel and reports `handed`, naming the channel. The actor's own act confirms it: the hook, the person opening it, the adapter's receipt, the outside call's first answer. Then come `handled` or `notHandled`. A crew with no computer side pulls, and says so.
- (b) **The fleet notifies.** Core sends email or push to a person's address on a new delivery.
- (c) **Per kind, ad hoc.** Each app or plugin does what suits it, and the fleet sees only acks.

**Pick: (a).**

- It is 0040 as it stands, generalised from "agent" to "actor": the trierarch and the plugin watcher are already its two instances.
- The fleet never speaks for a ship. The person's app or the gateway is the crew's computer side, acting as that ship, as the trierarch does.
- (b) puts a notifier and people's addresses in core, against 0.A and 0040.
- (c) leaves "why did nobody see it" undebuggable, against 0.S.

**What (a) changes, so that nothing is hidden:**

1. **The waker is a fact of the lease.** A push receive states who wakes the ship, and the ship's page shows it: the trierarch, the plugin watcher, the person's app, the gateway or the adapter. A lease that never push received shows "pull: nobody wakes it". So a chat with the connector is no longer silently unreachable between turns. Today only the local `aeolus-identity.sh show` says `wakes: the trierarch`.
2. **`handed` names its channel** (such as `tmux`, `watcher`, `push`, `email`, `tools/call`, `a2a-push`), kept in `DeliveryHanded`'s details. A delivery that waits shows how it was last handed over.
3. **A reminder is no new attempt.** A person who does not open a notification gets reminded with the same hand-over number, which 0040 already counts as no change. A reminder with a new number would count an attempt, and the fifth would make a person's message undeliverable.
4. **Clocks per kind.** The 10 and 60 minute clocks (0040) fit agents and apps. A person ship is never overdue for being away (0.L: an absent person is not stuck). It shows "handed through push, 3 h ago, not opened", read as facts with ages (0042), never as trouble.
5. **Trouble goes to the owner.** Overdue and not handled go by message to the owner's ship, argo as fallback (0.C), and reach the owner through this same pattern.

**Mathilde's go, as one instance:**

1. The issue tracker ship sends Mathilde's ship a question (0038's shape) asking for her go. Network rule: send.
2. Mathilde's person ship is crewed by her app, here the gateway, behind her company SSO (I-4).
3. The gateway waits on `inbox`, push receives the question, and sends her a push notification and an email: "The issue tracker asks for your go: <title>", with a link and no payload beyond the title. It reports `handed` no. 1 via `push`.
4. Two hours later she has not opened it, so the gateway reminds her as no. 1 again: no attempt counted.
5. She opens it in her app, or in her Claude through the gateway's person tools. Her app acks it: her own act is the confirmation.
6. She answers. The answer is a reply to the issue tracker. When her app closes the item, it reports `handled`.

At every step the issue tracker's owner, and argo, can read where the go stands: stored, handed through push, when, confirmed and answered.

**Options for what the channel may carry:**

- (a) the owner sets it per person ship: title only, or a link only;
- (b) the whole payload.

Pick: (a). Content leaving the fleet to an email or a chat tool is the owner's call, and a link keeps it in the app.

### 5.2 MCP out (and A2A out) delivery, as close to 0040 as the protocols allow (I-7)

**Purpose.** An outside MCP server or A2A agent behind a proxy ship is delivered to as an internal ship is: the same states, events and numbers, and the same Needs attention entries. Its owner and argo then read one model, and differences are named where a protocol forces them.

**The internal pattern (0040) beside MCP out and A2A out:**

| Step | Internal ship | MCP out | A2A out |
| --- | --- | --- | --- |
| Take it | `pushReceive`: pending to received, no attempt | the same: the gateway push receives for the proxy ship | the same |
| Hand over | the line typed into an idle session; `handed` no. n counts an attempt | the gateway sends `tools/call`; `handed` no. n via `tools/call` | the gateway sends `SendMessage` with the stable `messageId` (HMAC of the `msg_` id); `handed` no. n via `a2a` |
| Confirm (the promise ends) | the hook's `ack` when the turn takes it | the first answer from the server: a `CreateTaskResult` (the task is "durably created") or a complete result, `isError` included | `SendMessage` answered with a Task (accepted) or a Message |
| Work | the turn runs | with a task: `tasks/get` until terminal; without one: nothing, since the answer was the result | following the task: push to the gateway's webhook, `SubscribeToTask` or `GetTask` |
| Handled | the turn that took it ended by itself | a terminal result sent back as a reply naming the request, then `handled`. An error result is handled too: the call ran and its error is the reply | a terminal task state, artifacts or a final message sent back as replies, then `handled` |
| Died before confirmation | the session died with the line typed and nothing confirmed: handed again with the next number, an attempt | the stream broke or the gateway crashed with `tools/call` sent and no answer. **Whether the server ran it is unknown** | the same, but the same `messageId` goes again, which A2A defines for exactly this |
| Died after confirmation | handed once more (`isOnceMore`), no attempt; died again, `notHandled` | with a task: follow again with `tasks/get`, which repeats nothing, so it needs no once more. A task gone (TTL, not found) is `notHandled` | follow again (`GetTask` or `SubscribeToTask`); a task gone is `notHandled` |
| Turn and clocks | `turn` idle or busy; overdue after 10 min handed and not confirmed | no turn. The 10 minute handed clock holds, since an answer that takes 10 minutes is a died call | the same |
| Concurrency | one message per hand-over, only while idle | several in flight, up to a limit stated for the proxy ship | the same |

**Where it must differ, and why:**

1. **Confirmation can be the result.** A synchronous `tools/call` answers once, with the result. So for a server without the Tasks extension, ack and handled come together, which 0040 allows (ack, then handled at once).
2. **A died hand-over before confirmation is not always safe to repeat.** For an agent, a line nobody confirmed was not acted on: the turn never took it. For an outside tool, the server may have acted and lost the answer. MCP has no idempotency key (2026-07-28). This is the one real gap.
3. **No turn.** An outside server takes calls side by side, so the gateway reports no turn, and a concurrency limit replaces "one while idle".
4. **Once more has no counterpart.** Once confirmed, a task is followed, never run again. A sync result is already done.

**Making the retry safe.**

Options for a died hand-over before confirmation:

- (a) **hand again only where repeating is safe, otherwise stop and tell a human.**
  - Safe means:
    - an MCP tool argo marked repeatable when connecting the server, from its annotations (`readOnlyHint`, `idempotentHint` in MCP's tool annotations, which clients treat as untrusted unless the server is trusted, so argo's mark is the trust, shown on the proxy ship's statement);
    - an A2A agent, by its stable `messageId`.
  - Otherwise the gateway reports the delivery not handled with the reason "the call may have run; its answer was lost". It shows in Needs attention with Resend and Dismiss, and a human who can check the outside system decides.
- (b) **always hand again** (at least once).
- (c) **never hand again** (at most once, the first study's pick).
- (d) **send an Aeolus idempotency key** in the call's `_meta` (such as `io.aeolus/idempotencyKey`), honoured only by servers that know it, and hand again only to those.

Pick: (a), with (d) as a later addition that widens what is safe.

- (b) runs a payment twice.
- (c) silently drops a call that never reached the server, a lost message the promise forbids.
- (a) keeps the promise: nothing is lost unseen, and a human answers for the unknown (0.C). It also reuses the existing Needs attention and Resend.

**The sync and task cases in one line each:**

- **With the Tasks extension,** the unsafe window shrinks to the time between sending `tools/call` and its `CreateTaskResult`.
- **Without it,** the window is the whole call. So the gateway asks for a task (declares the extension) whenever the server supports it.

**Core changes this needs:**

- `handed` takes its channel (5.1).
- `notHandled` is also accepted for a delivery handed and not confirmed, with a reason, from a crew that judged it unsafe to hand again. Today it is only accepted after once more. Without this, the gateway can only hand again until the fifth attempt makes it undeliverable, which is exactly the blind retry (b).

**A2A out against the first A2A study.** It is at least once there. Here it becomes: retry with the same `messageId` is the designed path, and an agent that is known not to dedupe can be marked not repeatable by argo, which then falls under (a).

Options:

- (a) argo's mark per proxy ship, repeatable by default for A2A;
- (b) always repeat.

Pick: (a). The default follows the spec, and the exception is visible.

### 5.3 Synchronous waits (I-9)

**Purpose.** Decide whether the gateway ever holds an outside call open waiting for a ship's reply, given that Aeolus is asynchronous by design.

**What an outside caller expects:**

- **A2A.** `SendMessage` blocks by default until the task is terminal or interrupted (input or auth required), unless the client sets `returnImmediately`. It answers a Task or a Message.
- **MCP.** `tools/call` answers a result in its response.
  - A server may answer a task only if the client declared the Tasks extension in that request.
  - A broken stream loses the call, and 2026-07-28 has no resume.
  - How long mainstream clients wait before they give up was not verified here. It is client-side, and differs per client.

**What a bounded wait does:**

| To | Effect |
| --- | --- |
| Aeolus's promises | None. The request is stored before any wait, and the wait changes no fleet state. The guarantee holds in every option |
| The gateway | One held HTTP connection per waiting call, plus one waiting `receiveReply` against core. Load grows with how slow ships are, not with how much work there is. Proxies and load balancers in front of it cut long requests |
| Duplicates | The longer a call is held, the more streams break, and an MCP client resends with a new id, so more second messages without a key (I-7 in part 4) |
| Results | A reply after the bound still has to be collected, so the task and handle path exists anyway. A wait is only a fast path on top of it |
| The async model | Customers build integrations that assume an answer in the response. They work while a ship is fast, and break when it is busy, released or slow, which is the normal case for agents. A wait makes the gateway look synchronous where the fleet is not |

**Options:**

| Option | What it costs a customer's integration | What it costs Aeolus's async model |
| --- | --- | --- |
| (a) **Never wait.** Always answer at once: a task (A2A Task submitted; MCP task when declared), else an MCP handle and a result tool | Every call is two steps. In Claude or ChatGPT without Tasks, the model must call the result tool, so a CRM lookup takes two tool calls and a polling loop. A2A clients that rely on the blocking default must set `returnImmediately` or poll; serving blocking as immediate may fail A2A conformance | None: pure async, no held connections |
| (b) **Wait only for capabilities stated as fast** (a yes or no in the statement), up to the gateway's fixed bound | Fast tools are one call; others are two | A held connection per fast call. A fast tool on a slow day still falls back. Fast is a word with no number |
| (c) **A bound per capability in the statement** (`waitMs`, 0 by default, capped by the gateway's configured maximum), then the task or handle | A tool that states 2000 ms answers in one call when the ship keeps it. A capability that states nothing behaves as in (a). The behaviour is per tool and readable in the tool's statement | Held connections only for capabilities that asked for them, bounded by the cap. Async stays the default; the wait is opt-in, stated and visible (0.S). One number beside the deadline of 3.4 |

**Pick: (c).**

- Async stays the default: a capability that states nothing never holds a call.
- The ship's owner, who knows whether the CRM answers in 200 ms, states the wait as a fact that every reader sees. The gateway's cap is configuration, so no hidden timeout decides.
- It costs one field in the statement and the fallback the task path needs anyway.
- (a) makes every app call two steps in today's synchronous clients, which is the barrier to entry level 3 is meant to lower.
- (b) is (c) with a vaguer number.

**Open risk.** A2A conformance: a capability stated with 0 answers a blocking `SendMessage` as if `returnImmediately` were set. Check against the A2A conformance tests in the A2A-in slice. If it fails, A2A blocking calls take the gateway's cap as their wait.
