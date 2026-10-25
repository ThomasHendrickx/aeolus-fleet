# Gateway: tools by scope, and waking a person in chat

Design for [#1152](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1152) (part A) and [#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078) (part B), as one gateway design for Aeolus 0.32.0. Docs only.

Stage 1: purpose, lessons, questions. Nothing past the purpose is decided until Thomas agrees it.

## 1. Purpose

### Part A: which tools of an outside party a ship may call

An approver lets one ship search the company vault and another ship also write to it, without a network rule or a label for it. Network rules say where a ship may send: whether it reaches an outside party's proxy ship at all. Scopes say what it may do there: which of the party's switched-on tools it may call. Thomas: "labels would violate the network (labels) is where, scope is what rule".

For whom: the approver (`gateway:approve`), who knows what each tool of an outside MCP server does; and whoever grants scopes on ships (`scopes:grant`), who decides what each ship may do.

A good outcome:
1. A ship that reaches the company vault's proxy ship without the scope a tool needs gets a plain refusal on calling it, and the call never reaches the outside server.
2. Granting or revoking that scope is the existing scope grant on the ship, effective at its next call, with its event. No network rule or label changes.
3. Every ship that reaches the party still sees which tools exist; a tool with no scope set needs none beyond reaching the party.

Not the purpose: the tool switch per party (#1151, shipped); a scope check inside core for calls to outside parties; outside clients and agents calling into the fleet.

### Part B: wake a person through a chat app

A person learns that something waits for their person ship in the chat app they already have open all day, Slack, Discord or Teams, the same way web push and email wake them today. Thomas: "be where the user is".

For whom: a person with a person ship who lives in a chat app, and who turned that channel on.

A good outcome:
1. A delivery reaches Mathilde's person ship while they are away; within a minute their chat app shows a message from the gateway that something waits in their fleet.
2. The wake is a hand-over on the record, naming the chat channel, exactly as for web push and email (0040).
3. Nothing is on until the person turns it on, and they can turn it off.

Not the purpose: the phone app (#1079); quiet hours or escalation; core holding a chat address or sending anything.

## 2. Lessons to check against

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
| L11 | Web push and email only, "No chat webhook" (W1); each delivery woken once, gathered per window (W3, W10); the wake says only that something waits, by the fleet's name, with a link (W4); a page in focus is the channel (W6); consent first, nothing on by default (W8) | [wake a person](../wake-a-person/README.md), section 4 |
| L12 | One wake pattern for every kind: the crew's computer side hands over through its actor's channel and reports `handed` naming it; core sends nothing and holds no address | I-1; 0040; wake a person, section 3 |
| L13 | Email stays in pagasae; the address never leaves it | [0054](../../decisions/0054-sign-in.md), [0058](../../decisions/0058-pagasae-core-link.md); W2 |
| L14 | The shipped email wake has two open defects: a refused `handed` partway records the email as sent (#1165), and a 401 or 404 from pagasae is retried forever (#1166). A third channel would share that path | #1165, #1166 |
| L15 | A chat bot's token belongs to the app, not a person, and outlives whoever installed it | [actors](../accounts/actors.md), line 96 |
| L16 | A person answers in their client or on the gateway's page; the promise ends when they open a delivery (the gateway's ack) | [0038](../../decisions/0038-questions.md), 0001, 0040 |

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

### B1. Which chat app first

Slack, Discord and Teams each need a bot registered with the vendor, installed into a workspace, server or tenant.

1. **Slack first**, the others later on the same channel shape.
2. **Slack and Teams:** Teams is where companies on Microsoft live, but needs an Azure bot and a tenant admin's consent.
3. **All three.**

Pick: 1. One app proves the channel; each further app is a small slice once the shape holds.

### B2. What the chat wake carries, and whether the person answers there

W4 says the wake carries only that something waits and a link. "Be where the user is" may mean more.

1. **The wake as today:** the fleet's name, "something waits", the overview link. W4 unchanged; nothing of a payload reaches the chat vendor.
2. **Each waiting delivery's sender and first line, opened from chat:** the person sees what waits and opening it in chat acks it. Changes W4; content reaches the chat vendor's servers.
3. **Read, answer and mark done in chat:** the chat app becomes a full client of the person ship beside their MCP client and the gateway's page. Most "where the user is"; the largest slice, and every payload passes through the vendor.

Pick: 1 for 0.32.0. It keeps W4 and the hand-over exactly as web push and email; 2 or 3 can follow as their own design once a person asks for it.

### B3. Who sets up the chat app, and how a person's chat account is linked

The gateway must know which Slack user is which person ship. The address of a person stays out of core (L13), and a bot token belongs to the app (L15).

1. **One Slack app for the gateway, from its configuration (as the web push keys are); an actor holding a gateway scope installs it into the organisation's workspace on the gateway's page; each person links their own Slack account from the Overview** (sign in with Slack), which also turns the channel on (W8).
2. **Each organisation brings its own Slack app** and enters its credentials on the gateway's page; persons link as in 1. More setup per organisation; the organisation owns the bot.
3. **A webhook URL each person pastes in.** No install; W1 said no chat webhook, and the URL is a secret the person carries.

Pick: 1. The person consents by linking, the organisation decides by installing, and nothing new is asked of core or pagasae.
