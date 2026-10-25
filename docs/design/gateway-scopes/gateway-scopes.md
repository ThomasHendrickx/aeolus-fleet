# Gateway: tools by scope, and ships as Slack bots

Design for [#1152](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1152) (part A) and [#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227) with [#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078) (part B), as one gateway design. Part A ships in Aeolus 0.32.0, part B in 0.33.0. Docs only.

Stage 1: purpose, lessons, questions. Nothing past the purpose is decided until Thomas agrees it.

## 1. Purpose

### Part A: which tools of an outside party a ship may call (0.32.0)

An approver lets one ship search the company vault and another ship also write to it, without a network rule or a label for it. Network rules say where a ship may send: whether it reaches an outside party's proxy ship at all. Scopes say what it may do there: which of the party's switched-on tools it may call. Thomas: "labels would violate the network (labels) is where, scope is what rule".

For whom: the approver (`gateway:approve`), who knows what each tool of an outside MCP server does; and whoever grants scopes on ships (`scopes:grant`), who decides what each ship may do.

A good outcome:
1. A ship that reaches the company vault's proxy ship without the scope a tool needs gets a plain refusal on calling it, and the call never reaches the outside server.
2. Granting or revoking that scope is the existing scope grant on the ship, effective at its next call, with its event. No network rule or label changes.
3. Every ship that reaches the party still sees which tools exist; a tool with no scope set needs none beyond reaching the party.

Not the purpose: the tool switch per party (#1151, shipped); a scope check inside core for calls to outside parties; outside clients and agents calling into the fleet.

### Part B: ships as Slack bots (0.33.0)

A person in the company talks to a ship of the fleet in Slack as they talk to a colleague: a ship exposed as a Slack bot, with its own name, that they message directly or mention in a channel. Several ships may each be their own bot. Thomas: "Slack integration with potential multiple bots that get exposed to the fleet. So a ship in the fleet becomes a bot in slack." Waking a person in Slack is one part of it: what waits for their person ship shows where they already are ("be where the user is", #1078).

For whom: people who never open an MCP client or the gateway's page, the non-technical side of the company that Aeolus connects to the technical side (#1228); and whoever decides which ships appear in Slack.

A good outcome:
1. Mathilde messages the bot of the ship `release-notes` in Slack. The message is stored in the fleet as a message from their person ship before Slack is told OK; it is never lost, and a Slack retry never sends it twice.
2. The ship's answer, a reply to that message, appears in the same Slack conversation, from that ship's bot.
3. Which ships appear as bots is chosen by someone holding a scope for it. Which person may message which ship stays the network rules, as today: a person whose person ship does not reach the ship gets a plain refusal in Slack.
4. A message for Mathilde's person ship from any ship shows in Slack once they turned Slack on, and never before.
5. Every hand-over to Slack is on the record, naming the Slack channel (0040).

Not the purpose: Discord and Teams (later, on the shape Slack proves); Slack users with no account in the organisation; ships talking to each other through Slack; Aeolus reading or summarising payloads; meetings in Slack.

## 2. Lessons to check against

Part A:

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Scope says what, a rule says where, for every kind of interaction | [0034](../../decisions/0034-network-rules.md); Thomas on #1152 |
| L2 | A plugin declares one namespace for good, its whole list at most 20 scopes, each part at most 32 characters; core stores them and never checks them, the plugin enforces them. A second namespace and resource-scoped scopes were rejected | [0046](../../decisions/0046-scope-catalogue.md) |
| L3 | The gateway declares one namespace, `gateway`, with one scope, `gateway:approve`, once at connect | gateway `src/core/connection/connect.ts` |
| L4 | A scope change on a live ship takes effect at its next call. So the gateway reads the sender's scopes on each call, never from the message: no rights travel with a message | 0046; [0057](../../decisions/0057-actors.md) |
| L5 | An approver grants only scopes it holds; the gateway's page shows each control only to an actor holding its scope | [0056](../../decisions/0056-outside-parties.md) |
| L6 | Tool switches are per party: a tool off is neither stated nor called ("tool not enabled for this party"), a tool the server adds later starts off, and a party with no switches kept has every tool on. Today the sender's scopes are read nowhere on the call path | #1151; gateway #99, `src/core/mcp-out/hand-call.ts` |
| L7 | Gating a proxy ship by label needs the fleet to apply network rules, which cuts off traffic that runs today | #1154 |
| L8 | Scope pickers show raw codes, not the declared descriptions; a party's new scopes would add to that | #1205 |
| L9 | No policy: scopes are enforced exactly, nothing added on top | [0016](../../decisions/0016-no-policy.md) |
| L10 | An outside party's own OAuth scopes never become fleet scopes | interop design, `design/interop-mcp` branch |

Part B:

| # | Lesson | Source |
| --- | --- | --- |
| L11 | No send returns OK before the message is durably stored; Slack retries an event not answered within 3 seconds, so the Slack event's own id must make a retry the same send | CLAUDE.md promise 2; 0003; Slack Events API retries |
| L12 | Web push and email only, "No chat webhook" (W1); each delivery woken once, gathered per window (W3, W10); the wake carries no content, only the fleet's name and a link (W4, #1020); consent first, nothing on by default (W8). Part B changes W1 and W4 for Slack | [wake a person](../wake-a-person/README.md), section 4 |
| L13 | One wake pattern for every kind: the crew hands over through its actor's channel and reports `handed` naming it; core sends nothing and holds no address | I-1; [0040](../../decisions/0040-delivery-protocol.md) |
| L14 | The promise ends at the actor's confirmation; for a person that is opening the delivery, today the gateway's ack | [0001](../../decisions/0001-ack-on-receipt.md), 0040 |
| L15 | A person reaches their person ship through the gateway, which crews it for all their clients, with no crew token in the client; a human's messages are their person ship's | [0015](../../decisions/0015-ship-identity-per-conversation.md), [0043](../../decisions/0043-core-surface.md), [0057](../../decisions/0057-actors.md) |
| L16 | Who may message whom is network rules (send reach), refused with a plain "No rule matches"; no rights travel with a message | [0034](../../decisions/0034-network-rules.md), 0046 |
| L17 | An outside party needs an owner, which only a real account can be; an anonymous request was rejected. The fleet's outside parties are a switch per fleet, off by default | [0056](../../decisions/0056-outside-parties.md) |
| L18 | A chat bot's token belongs to the app, not a person, and outlives whoever installed it | [actors](../accounts/actors.md), line 96 |
| L19 | Identity is pagasae's, and the address stays there; core holds no email | [0054](../../decisions/0054-sign-in.md), [0058](../../decisions/0058-pagasae-core-link.md) |
| L20 | A delivery once reached another ship's session after a restart (P1); a Slack user to person ship mapping, and a bot to ship mapping, must be exact | #881 |
| L21 | Bots that answer every message flood or loop; Slack bots skip `bot_message` | [meetings](../meetings/meetings.md), L1 |
| L22 | A ship's statement (summary, capabilities) is what others see of it; payloads are at most 64 KB | [0047](../../decisions/0047-discovery-and-statements.md), [0006](../../decisions/0006-payload-limit.md) |
| L23 | The shipped email wake has two open defects on the wake path a Slack channel would share: a refused `handed` partway (#1165), and an error retried forever (#1166) | #1165, #1166 |
| L24 | Getting into the fleet must be flawless for non-technical people | #1228 |

## 3. Questions for Thomas

### A1. Where the party scopes live

#1152 names scopes per party in their own namespace, such as `company-memory:read`. 0046 lets the gateway hold one namespace, at most 20 scopes, and rejected a plugin taking several namespaces and resource-scoped scopes. A scope named after a party also says where, which L1 gives to network rules.

1. **Kinds of tool, not parties:** the gateway declares a few scopes in `gateway`, such as `gateway:read` and `gateway:write`; the approver marks each tool with one. A ship's network rules decide which parties it reaches, its scope which kind of tool. Fits 0034 and 0046 as they stand. A ship that may write at the CRM may also write at the vault if it reaches both.
2. **Party scopes inside `gateway`:** `gateway:company-memory-read`. Exactly the per-party control #1152 asks; fits 0046, but the 20-scope cap allows about nine parties of two scopes each, and a party's name sits in a 32-character action.
3. **A namespace per party** as #1152 writes it: changes 0046 (several namespaces per plugin, a namespace freed when its party retires). Most direct for the approver; reopens a recorded decision and mixes where into what.

Pick: 1. It is Thomas's own rule taken strictly: where a ship sends is the network, what it does there is the scope. It needs no change to 0046 and no cap.

### A2. Which outside parties it covers

The gateway calls tools of two kinds of party: outside MCP servers (tools from `tools/list`) and outside A2A agents (skills on their card, called by message).

1. **Outside MCP servers only.** The tool switch and the company vault are MCP; A2A agents keep their party-wide call.
2. **Both.** One rule for every outside tool; an A2A skill has no switch today, so this also adds a switch per skill.

Pick: 1. The need in #1151 and #1152 is the company vault; A2A follows when an agent needs it.

### B1. What one bot in Slack is

In Slack a bot people can message directly, with its own name and picture, is its own Slack app, installed into the workspace (by its admin, or with the admin's approval).

1. **One Slack app per exposed ship**, which the gateway makes from Slack's app manifest and someone installs into the workspace once per ship. Each ship is truly its own bot: its own direct messages, mentions and name. Each ship takes one install in Slack.
2. **One Slack app for the gateway**, where a person names the ship in their message and answers show with the ship's name and picture. One install; but in Slack it is one bot, and a person cannot message a ship directly.

Pick: 1. It is Thomas's words, "a ship in the fleet becomes a bot", and it is what a non-technical person expects of a colleague in Slack.

### B2. Who may talk to a bot

1. **Only an account of the organisation that linked its Slack account** (one sign in with Slack from the gateway's Overview, or offered at their first message to a bot). Their message is their person ship's; network rules decide which ships they reach.
2. **Anyone in the workspace:** a linked account as in 1, and anyone else through one proxy ship for the workspace, an outside party with an owner (0056).

Pick: 1. Every message keeps a real sender, network rules stay the one where, and 0056's reason against anonymous requests holds. The link is one step, offered in Slack itself (#1228).

### B3. Where a bot listens

1. **Direct messages only.**
2. **Direct messages, and a mention in a channel it was added to**, answered in that message's thread. The person who mentions it is the sender; other people in the thread see the answer.
3. **As 2, and every message in a channel it was added to.**

Pick: 2. It is how people use a colleague in Slack; 3 floods the ship (L21), and a bot never takes a message from another bot.

### B4. When a message to a person counts as received

A ship's answer, or any message to the person ship, shows in Slack in full. Today the promise ends when the person opens it (L14).

1. **Slack accepted the post: the gateway acks then.** The person's app received it in full (0001); in Slack, there is nothing further to open.
2. **Handed with the Slack channel; acked when the person opens it on the gateway's page or reacts in Slack.** Closer to "the person saw it"; deliveries stay open while Slack shows them.

Pick: 1. A message shown in full in the person's app is received, as for any app that crews a ship. What Slack cannot show in full (another content type, or over Slack's length) goes as a link and is handed only, as a wake.

### B5. What a message from a ship that is not a bot does in Slack

A ship with no bot, or a question (0038) from any ship, may also wait for the person ship.

1. **Shown in full in a direct message from the gateway's own bot, consent first.** Everything that waits is where the person is; W4 changes for Slack only, web push and email keep it.
2. **A wake only, as W4:** "something waits", the fleet's name and a link; content only from ships that are bots.

Pick: 1. One place for everything that waits, and a person answers it in the same direct message; the person chose Slack by turning it on (W8).

### B6. Who exposes a ship as a bot

1. **An actor holding `gateway:approve`, within manage reach of the ship**, on the gateway's page; the workspace's own install approval still applies on Slack's side.
2. **A new gateway scope for Slack**, within manage reach of the ship, so approving outside parties and exposing ships are held apart.
3. **The ship's owner**, within manage reach, with no gateway scope.

Pick: 2. Putting a ship in front of the whole company is not approving an outside party; a scope of its own lets an organisation give it to the person who runs Slack. It still fits the gateway's 20-scope namespace.
