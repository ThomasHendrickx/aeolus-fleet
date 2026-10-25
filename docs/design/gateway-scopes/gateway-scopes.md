# Gateway: tools by scope, and ships as Slack bots

Design for [#1152](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1152) (part A) and [#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227) with [#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078) (part B), as one gateway design. Part A ships in Aeolus 0.32.0, part B in 0.33.0. Docs only.

Part A: stage 2, the detail (purpose and picks agreed by Thomas, 25 Oct). Part B: stage 1, purpose, lessons and questions; nothing past its purpose is decided until Thomas agrees it.

## 1. Purpose

### Part A: which tools of an outside party a ship may call (0.32.0, agreed by Thomas)

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

## 3. Part A: decisions (Thomas, 25 Oct)

Thomas: "Ok that design for gateway with your picks I agree with. It allows for the value where it matters and gives control to users without opening the flood gates."

| # | Rule |
| --- | --- |
| A1 | **A new core scope, `scopes:define`, held by any actor; defined scopes are the fleet's own**, changed and removed by any holder, never retired with the one who defined them |
| A2 | **An actor holding `gateway:approve`, within manage reach of the proxy ship, sets which scopes a tool needs**, exactly as switching a tool |
| A3 | **A defined scope takes any free namespace; core's and the known plugins' namespaces are reserved**; a plugin declaring a namespace the fleet uses is refused |
| A4 | **No cap on the fleet's scopes**; the 20 per namespace stays for plugins. Thomas: "The 20 max limitation will not count for the fleet owner, as Argo can also hold as many labels as needed" |
| A5 | **A tool may require several scopes: always AND**, the calling ship holds every one |
| A6 | **Setting requirements is quick for a server with 50 tools.** Thomas: "we need some UX friendly ways to set these on the tools. Mcp with 50 tools takes some time" |

## 4. Part A in detail

### 4.1 Core: the fleet's scopes

- **`scopes:define`** joins the catalogue (0046): define, change and remove the fleet's scopes; where: the fleet. argo holds it as every scope; the fleet manager's account holds it (0051); a group may give it (0052).
- **Define** (`fleet.defineScope`): a scope `<namespace>:<action>` in today's grammar (common's `SCOPE_NAME_PATTERN`) and a one-line description of 1 to 200 characters. Refused, each by name: a malformed scope or description; a core namespace; a reserved namespace (`gateway`, `squadrons`, `trierarch`, a list in common beside the core ones); a namespace a plugin declared (NAMESPACE_TAKEN, naming the plugin's ship); a scope the fleet has (CONFLICT). Writes `ScopeDefined`.
- **Change the description** (`fleet.describeScope`). Writes `ScopeDescribed`. A scope is never renamed: a new name is a new scope.
- **Remove** (`fleet.removeScope`): refused while an active ship holds it (SCOPE_HELD, naming how many ships), as 0046 refuses a declaration that drops a held scope. Writes `ScopeRemoved`. An account token naming a removed scope gives nothing: the scope no longer exists to be checked.
- **A namespace holds either the fleet's scopes or one plugin's.** `fleet.declareScopes` by a plugin for a namespace the fleet uses is refused NAMESPACE_TAKEN, "by the fleet". Removing the fleet's last scope of a namespace frees it.
- **Listed** by `fleet.scopes` beside the core and plugin namespaces, each namespace saying whose it is: core, a plugin's ship, or the fleet. pagasae's group editor and every scope picker read this list, so the fleet's scopes appear there with their descriptions (#1205).
- **Granted as any scope** (0046): at commission or by `scopes:grant`, only by an actor that holds it. A newly defined scope is held by argo and the fleet manager, who grant it onwards. Holding `scopes:define` does not let an actor grant a scope it does not hold, so no one widens their own access by defining one.
- **No cap.** Every refusal of a malformed or taken name names the rule.
- **Console.** A Scopes page beside Labels and Network: every namespace with its scopes and descriptions, read-only for core and plugin namespaces; for the fleet's, Define scope (Dialog), Change description and Remove (each refusal inline). Shown to actors holding `fleet:read`; the controls to actors holding `scopes:define`.

### 4.2 Gateway: what a tool needs, and the check

- **Requirements, kept with the party in the gateway's database:**
  - an outside MCP server: a set of scopes for the party as a whole, and a set per tool;
  - an outside A2A agent: one set for the agent (its messages name no skill, L26).
  - A tool needs the party's set and its own, all of them (A5). An empty set needs nothing beyond reaching the party. A tool the server adds later needs the party's set, and starts off as today (#1151).
  - Kept by scope text and tool name, never by a ship's name or id; retiring the party removes them.
- **Changing them** takes `gateway:approve` and manage reach on the proxy ship (A2). A change names the party's requirements version it was made on and is refused CONFLICT once they moved, so two approvers never overwrite each other unseen. Every scope set must be in `fleet.scopes`; one that is not is refused by name. Any listed scope may be required (core, a plugin's, the fleet's): no policy (0016).
- **The check, on every call**, after the tool switch, before the hand-over (gateway `src/core/mcp-out/hand-call.ts`; `src/core/a2a-out/hand-a2a-message.ts` for an agent):
  1. Re-read the party's requirements as they are now, as the switch is re-read: an approver may change them while a call waits.
  2. Read the calling ship's scopes from core (`fleet.ship` on the delivery's sender, the gateway reading every ship by the plugin rule), never from the message (0057).
  3. Holds every required scope: the call goes on as today.
  4. Lacks one or more: the gateway answers the sender a tool error naming what is missing, "update_lead needs crm:write-leads, which release-notes does not hold", and reports the delivery handled. The call never reaches the server. For an A2A agent, the same as a reply to the sender.
  5. Core does not answer the read: the call waits and is tried again, as a call core refused `handed` for today. It is never made unchecked.
- **The statement.** Each capability states the scopes it needs (open point P1).
- **Cost.** One read of the sender's ship per call, beside the hand-over the call already makes. No cache: a scope revoked must hold at the next call (0046).

### 4.3 Gateway: setting requirements on 50 tools

The Tools section of an outside MCP server's page becomes a table. Same parts as the gateway's pages today (Switch, Tag, Dialog); controls only for an actor holding `gateway:approve` within manage reach, others see the same table read-only.

- **Columns:** a checkbox; the tool's name (mono) and description; the server's hints as tags, Read only (readOnlyHint) and Destructive (destructiveHint), shown only where the server gives them; On or Off (the switch, as today); Needs: each required scope as a chip, the party's set shown muted, the tool's own plain.
- **Toolbar:** a filter by name; a filter by state (All, On, Off, New, Needs nothing); Select all shown; the count selected.
- **For the whole party:** a line above the table, Every tool needs, with its chips and Change… (Dialog). This is the default A6 asks for: one scope that guards the whole server is set once.
- **Bulk on the selected tools:** Set scopes… opens a Dialog: a Combobox of the fleet's listed scopes with their descriptions (search helps), several at once, and a choice of Add to each, Remove from each, or Replace with these; the footer says "Applies to 12 tools". Switch on and Switch off act on the selection too.
- **Suggestions from hints:** Suggest from hints… opens a Dialog with two pickers, Scopes for read-only tools and Scopes for the other tools, and the list it would change: every tool with no scope of its own and a hint from the server, read-only (readOnlyHint) into the first, readOnlyHint false or destructiveHint into the second. Tools without hints are listed apart, untouched. Nothing applies until the approver confirms: hints are the server's claim, never trusted on their own (gateway `src/core/mcp-out/ports.ts`).
- **Feedback:**
  - loading: the table shows skeleton rows while the server's `tools/list` is read; a server that does not answer shows the requirements kept per tool name and says the server did not answer, editing still allowed;
  - saving: the Dialog's action shows its spinner and blocks input; a bulk change is one transaction, all tools or none;
  - success: the Dialog closes, the changed rows highlight (`--highlight`), and a Toast says "crm:read-leads set on 12 tools";
  - failure: the Dialog stays open with the refusal inline (a scope not listed, no longer an approver, CONFLICT "The requirements changed since you opened this page", with Reload), nothing changed.
- **An A2A agent's page** shows one Needs line with Change…, as the party line above.
- **Phone:** rows stack; the toolbar's filters and the bulk actions open in a bottom Sheet (conventions).

## 5. Part A: flows

**Define and grant.** The fleet manager opens Scopes in the console and defines `crm:read-leads` ("Read leads in the CRM") and `crm:write-leads`. Core writes `ScopeDefined` twice. pagasae's group editor now offers both; the fleet manager gives Sales agents `crm:read-leads`, or grants it on the ship `lead-scout` with `scopes:grant` (`ScopesChanged`).
- Unhappy: `squadrons:read` is reserved; `gateway:x` is taken by the gateway's ship; `crm:read-leads` exists already; each refused by name, nothing written.

**Set the requirements.** An approver opens the CRM's page: 50 tools, skeleton rows, then the table. They set Every tool needs to nothing, use Suggest from hints with `crm:read-leads` and `crm:write-leads`: 31 tools get read, 14 get write, 5 have no hint and are listed apart. They filter by "delete", select the 3 delete tools and Add `crm:admin`. Each step one transaction, a Toast, rows highlighted.
- Unhappy: another approver changed the CRM meanwhile, CONFLICT inline with Reload; `crm:admin` not defined, refused by name; the approver lost `gateway:approve`, refused and the controls go at reload.

**A call.** `lead-scout` sends the CRM's proxy ship a call of update_lead. Core checks send reach (where) and stores it. The gateway takes the delivery: the switch is on; update_lead needs `crm:write-leads`; core answers `lead-scout`'s scopes: `crm:read-leads` only. The gateway replies "update_lead needs crm:write-leads, which lead-scout does not hold" and reports handled; the CRM never sees the call.
- Happy: with `crm:write-leads` granted, the next call goes through, as today.
- Unhappy: core does not answer the scope read, the call waits and is tried again, never made unchecked; the scope is revoked while the call waits, the check at hand-over refuses it; the requirement is removed while it waits, the call goes on.

**Remove a scope.** The fleet manager removes `crm:admin`. Refused while ships hold it, naming how many; once revoked everywhere, removed. Tools that still require it refuse every call (no ship holds it any more) and show it on the CRM's page as no longer defined, until an approver changes them.

## 6. Part A: open points for Thomas

### P1. Does a tool's capability state the scopes it needs?

1. **Yes**, in the statement every reaching ship reads (0047): an agent sees before it calls that update_lead needs `crm:write-leads`, and does not try and fail. The fleet's scopes are listed to every actor anyway.
2. **No**: a ship learns only from the refusal.

Pick: 1. A calling agent plans with it; it reveals nothing `fleet.scopes` does not.

### P2. Does a refusal name the missing scope?

1. **Yes**: "update_lead needs crm:write-leads, which lead-scout does not hold". The ship's owner knows what to grant.
2. **No**: "lead-scout may not call update_lead", as a network refusal says only "No rule matches" (0034).

Pick: 1. Scopes are public in the fleet, and the refusal is the way out (0057's fail-safe: a failure visible and its way out).

## 7. Part A: slices for 0.32.0

| # | Slice | Repository | Done when |
| --- | --- | --- | --- |
| S1 | Core: the fleet's scopes. `scopes:define`; define, describe, remove; reserved namespaces; a plugin refused a namespace the fleet uses; `fleet.scopes` says whose each namespace is; granting as any scope; events. 0046 and its index line changed, the blueprint's scope lines | aeolus-fleet | Use cases with in-memory ports, the repository with Testcontainers, including a define racing a plugin's declare of the same namespace |
| S2 | Console: the Scopes page; scope pickers show descriptions (#1205 for the fleet's scopes) | aeolus-fleet | Storybook states (empty, list, define, refusals), Playwright: define, describe, remove refused while held |
| S3 | Gateway: requirements per party, per tool and per A2A agent (AND); changing them with the version check; the check on every call for MCP and A2A; the statement (P1); minimum core version raised (docs/compatibility.md) | aeolus-fleet-gateway | A call refused without reaching the server, a call that goes through, a revoke while waiting, core not answering, concurrent changes refused |
| S4 | Gateway pages: the tools table, filters, select many, bulk Set scopes and switches, Every tool needs, Suggest from hints, loading, success and failure | aeolus-fleet-gateway | Each state shown with a 50-tool test server; one transaction per bulk change |

S1 before S3: the gateway needs the fleet's scopes to require them. S2 and S4 follow their server slices.

## 8. Part B: questions for Thomas (0.33.0)

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
