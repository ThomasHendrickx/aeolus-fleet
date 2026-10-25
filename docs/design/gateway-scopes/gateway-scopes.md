# Gateway: tools by scope, and ships as Slack bots

Design for [#1152](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1152) (part A) and [#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227) with [#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078) (part B), as one gateway design. Part A ships in Aeolus 0.32.0, part B in 0.33.0. Docs only.

Stage 1: purpose, lessons, questions. Nothing past the purpose is decided until Thomas agrees it.

## 1. Purpose

### Part A: which tools of an outside party a ship may call (0.32.0)

The company names what its ships may do at outside parties, in its own words: `crm:read-leads`, `crm:write-leads`, `company-memory:write`, `finance:read`. On an outside MCP server's page, an approver sets which of these scopes a calling ship must hold for each tool; for an outside A2A agent, one scope for the agent as a whole, since its messages name no skill (L26). The gateway refuses a call from a ship that does not hold it. Thomas: "the admin, or ship owner assigns scope requirements in the configuration screen of that MCP or a2a. Scopes can be added by the fleet owner. For example crm:read-leads, and then assigns that scope to the tools of the CRM MCP ship"; and on the principle, "labels would violate the network (labels) is where, scope is what rule".

For whom: the fleet manager (0050's word for Thomas's "fleet owner"), who knows the company's words for what work may be done; the approver (`gateway:approve`), who knows what each tool does; whoever grants scopes on ships (`scopes:grant`).

A good outcome:
1. On the CRM's page the approver sets search_leads and read_lead to need `crm:read-leads`, and update_lead to need `crm:write-leads`. On the company vault's page, write_note and delete_note need `company-memory:write`; search and read need none.
2. A ship that reaches the CRM's proxy ship without `crm:write-leads` gets a plain refusal on update_lead, and the call never reaches the CRM.
3. One scope may guard tools of several parties: `finance:read` on the accounting server and on the payroll server.
4. Defined scopes are granted like any scope (`scopes:grant`, or a group in pagasae), effective at the next call, with its event. No network rule or label changes.
5. Renaming or retiring a proxy ship moves no grant: nothing is keyed by a ship's name.

How it holds together:
- A tool call is something a ship does towards another ship: it sends a message to the party's proxy ship, naming the tool. Core checks the sender's send reach to the proxy ship (where). The gateway, crewing the proxy ship, checks that the sender holds the scope the tool needs (what), read from core on each call (0057), as squadrons checks `squadrons:form` on a ship that asks it by message (L25). The proxy ship's own scopes are not part of that check.
- A scope names a kind of work (`crm:read-leads`), never a ship: a second CRM server takes the same scope, and which server a ship reaches stays the network rules'.
- **Core adds** defined scopes: define a scope with its description, change the description, remove it (refused while a ship holds it, as 0046 refuses today), listed by `fleet.scopes` beside the plugins' namespaces, granted as any scope; a new kind of namespace holder beside the plugins, which changes 0046 (A1, A3). Defined scopes have no cap: the 20 per namespace stays for plugins only. Thomas: "The 20 max limitation will not count for the fleet owner, as Argo can also hold as many labels as needed".
- **The gateway adds** a required scope per tool and per A2A agent, kept with the party by scope text; the check on each call; the control on the party's page. A required scope no longer defined refuses every call to that tool until changed: closed, never open.

Not the purpose: the tool switch per party (#1151, shipped); scope checks for calls between agent ships (a receiving agent ship is never a policy point, 0046); outside clients and agents calling into the fleet; a scope per A2A skill (L26).

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
| L25 | A plugin ship asked by message checks the asker's scope in its own namespace, read from core: squadrons forms a squadron by message from any ship holding `squadrons:form`. No rights travel with the message; the plugin enforces its own scopes | [0017](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/decisions/0017-squadrons-package.md), [blueprint](../../blueprint.md) "Scopes say what", 0046 |
| L26 | The gateway sends an outside A2A agent an A2A message with no skill named; the card's skills only describe the agent | gateway `src/core/a2a-out/agent-message.ts`, `agent-statement.ts` |
| L27 | Labels are defined by an actor holding `labels:define`, owned by it and retired with it, referred to by ids so a text change moves nothing | [0031](../../decisions/0031-labels.md) |
| L28 | Owner is only a ship's; the fleet manager manages one fleet and holds every scope it offers | [0050](../../decisions/0050-domain-language.md), [0051](../../decisions/0051-organisation.md) |
| L29 | Groups in pagasae give scopes per fleet; an account's scopes ride in its token | [0052](../../decisions/0052-groups.md), [0058](../../decisions/0058-pagasae-core-link.md) |

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

### A1. Who defines scopes, and whose they are

1. **A new core scope, `scopes:define`, held by any actor (0053); defined scopes are the fleet's own**, changed and removed by any holder, never retired with the one who defined them. The fleet manager holds it, as every scope (0051).
2. **As labels (0031): a defined scope belongs to its definer**, only it changes or removes it, and it goes when the definer retires. One owner answers for each scope; a retired ship takes the company's words with it, and every tool that needed them then refuses.
3. **Only the fleet manager**, as an account right in pagasae. Simplest to explain; against 0053, where every job is a scope any actor may hold.

Pick: 1. Scopes are the company's words, not one ship's; a definer leaving must not close tools across the fleet.

### A2. Who sets which scope a tool needs

1. **An actor holding `gateway:approve`, within manage reach of the proxy ship**, exactly as switching a tool on or off (#1151). The proxy ship's owner has manage reach by the built-in rule (0034), so an owner who holds `gateway:approve` sets it.
2. **Also the proxy ship's owner without `gateway:approve`.** Thomas's "or ship owner" read literally; ownership becomes a right of its own, which no decision makes it today (0045: the owner is asked; 0053: every job is a scope).

Pick: 1. One rule for everything on a party's page, and rights stay scopes.

### A3. Which namespaces a defined scope may use

Today a namespace is taken by a plugin for good (`gateway`, `squadrons`, `trierarch`), and core's five are reserved (0046).

1. **Any free namespace, with the known plugins' namespaces reserved beside core's**; a plugin declaring a namespace the fleet defined scopes in is refused CONFLICT, naming it. Company words as Thomas wrote them (`crm:read-leads`).
2. **Any free namespace, nothing reserved**: the first to take a name keeps it. A fleet that defines `squadrons:...` stops squadrons from connecting.
3. **One fixed namespace for every defined scope**, such as `org:crm-read-leads`. No clash with plugins ever; the company's word squeezed into one 32-character action.

Pick: 1. Thomas's form, and the plugins Aeolus ships never collide.

Pick for part A as a whole: Thomas's proposal over the gateway-only options weighed before (kinds of tool in `gateway`, party scopes in `gateway`, a namespace per party, `gateway:<proxy ship>:<scope>`). It gives control per kind of work in the company's words, across parties, keyed by nothing that a rename or a reuse moves, with the two-part grammar unchanged. Its cost is a core slice for defined scopes and a change to 0046, before the gateway slice.

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
