# Gateway: tools by scope, and ships as Slack bots

Design for [#1152](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1152) (part A) and [#1227](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1227) with [#1078](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1078) (part B), as one gateway design. Part A ships in Aeolus 0.32.0, part B in 0.33.0. Docs only.

Part A: approved by Thomas (25 Oct); the build starts from its slices. Part B: approved by Thomas (25 Oct), "slack bots approved"; the build starts from its slices.

## 1. Purpose

### Part A: which tools of an outside party a ship may call (0.32.0, approved)

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

### Part B: ships as Slack bots (0.33.0, approved)

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
- **Changing them** takes `gateway:approve` and manage reach on the proxy ship (A2). The gateway asks core `fleet.checkManage` on the proxy ship as the approver, after the `gateway:approve` check and before any change, clearing included: any actor calls it with no scope, and it answers OK, or NOT_REACHABLE for a ship outside the caller's manage reach by the rule every fleet:manage call checks, the refusal recorded as theirs is (0034). A change names the party's requirements version it was made on and is refused CONFLICT once they moved, so two approvers never overwrite each other unseen. Every scope set must be in `fleet.scopes`; one that is not is refused by name. Any listed scope may be required (core, a plugin's, the fleet's): no policy (0016).
- **The check, on every call**, after the tool switch, before the hand-over (gateway `src/core/mcp-out/hand-call.ts`; `src/core/a2a-out/hand-a2a-message.ts` for an agent):
  1. Re-read the party's requirements as they are now, as the switch is re-read: an approver may change them while a call waits.
  2. Read the calling ship's scopes from core (`fleet.ship` on the delivery's sender, the gateway reading every ship by the plugin rule), never from the message (0057).
  3. Holds every required scope: the call goes on as today.
  4. Lacks one or more: the gateway answers the sender a tool error naming what is missing, "update_lead needs crm:write-leads, which release-notes does not hold", and reports the delivery handled. The call never reaches the server. For an A2A agent, the same as a reply to the sender.
  5. Core does not answer the read: the call waits and is tried again, as a call core refused `handed` for today. It is never made unchecked.
- **The statement.** Each capability states the scopes it needs (P1).
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

## 6. Part A: transparency (Thomas, 25 Oct)

Thomas: "P1 yes / P2 yes / I prefer transparancy here / Approved".

- **P1.** Each capability states the scopes it needs, in the statement every reaching ship reads (0047): an agent sees before it calls that update_lead needs `crm:write-leads`.
- **P2.** A refusal names what is missing: "update_lead needs crm:write-leads, which lead-scout does not hold".

## 7. Part A: slices for 0.32.0

| # | Slice | Repository | Done when |
| --- | --- | --- | --- |
| S1 | Core: the fleet's scopes. `scopes:define`; define, describe, remove; reserved namespaces; a plugin refused a namespace the fleet uses; `fleet.scopes` says whose each namespace is; granting as any scope; events. 0046 and its index line changed, the blueprint's scope lines | aeolus-fleet | Use cases with in-memory ports, the repository with Testcontainers, including a define racing a plugin's declare of the same namespace |
| S2 | Console: the Scopes page; scope pickers show descriptions (#1205 for the fleet's scopes) | aeolus-fleet | Storybook states (empty, list, define, refusals), Playwright: define, describe, remove refused while held |
| S3 | Gateway: requirements per party, per tool and per A2A agent (AND); changing them with the version check; the check on every call for MCP and A2A; the statement (P1); minimum core version raised (docs/compatibility.md) | aeolus-fleet-gateway | A call refused without reaching the server, a call that goes through, a revoke while waiting, core not answering, concurrent changes refused |
| S4 | Gateway pages: the tools table, filters, select many, bulk Set scopes and switches, Every tool needs, Suggest from hints, loading, success and failure | aeolus-fleet-gateway | Each state shown with a 50-tool test server; one transaction per bulk change |

S1 before S3: the gateway needs the fleet's scopes to require them. S2 and S4 follow their server slices.

## 8. Part B: decisions (Thomas, 25 Oct)

Purpose agreed. Thomas on long-running conversations: "I was thinking ling running meetings we will need to look at in the future" (#1254, later).

| # | Rule |
| --- | --- |
| B1 | **One Slack app per exposed ship**, made by the gateway from Slack's app manifest and installed into the workspace once per ship. Thomas: "Biggest in setup but best in execution and user experience" |
| B2 | **Only an account of the organisation that linked its Slack account talks to a bot**; its message is its person ship's, and network rules decide which ships it reaches |
| B3 | **Direct messages, and a mention in a channel the bot was added to**, answered in that message's thread. Thomas: "for 3 we need to look at meetings, a slack bot is for now already a good first step" |
| B4 | **A message to a person counts as received when Slack accepted the post**: the gateway acks it then. What Slack cannot show in full goes as a link and is handed only |
| B5 | **A message from a ship that is not a bot shows in full in a direct message from the gateway's own bot, consent first.** W4 changes for Slack only; web push and email keep it |
| B6 | **A new gateway scope for Slack**, `gateway:slack`, within manage reach of the ship, apart from `gateway:approve` |

These change W1 (Slack joins web push and email as a channel; still no chat webhook) and W4 for Slack (L12). The build records them in a decision of their own.

## 9. Part B in detail

### 9.1 Connecting a workspace

- An actor holding `gateway:slack` opens Slack on the gateway's pages and connects the fleet to one workspace by pasting an app configuration refresh token, which Slack issues per user and workspace on its app management page. The gateway keeps it in its vault and rotates it (`tooling.tokens.rotate`, every 12 hours, single use).
- With it the gateway makes its own bot first (B5): one Slack app named after the fleet, installed by the same person through Slack's install screen.
- A workspace may serve several fleets, each connected on its own with its own bots (P-B4).
- What the page shows: connected (workspace name, by whom), the configuration token's state (fresh, or refused by Slack: "Connect again to make or change bots; bots already installed keep working"), the gateway's bot (installed or not), the ships exposed. Disconnect removes every bot the gateway made (`apps.manifest.delete`) after a confirm.
- The configuration token belongs to one Slack user and can change only the apps it made (L18). If that user leaves Slack, installed bots keep working on their own bot tokens; making, renaming or removing one waits until someone connects again.
- `gateway:slack` is the gateway's second declared scope (L3), beside `gateway:approve`.

### 9.2 Exposing a ship as a bot

- An actor holding `gateway:slack`, within manage reach of the ship (B6), picks an agent ship or an outside A2A agent's proxy ship (Combobox) and presses Expose (P-B3). An outside MCP server's proxy ship is not offered: it takes tool calls, not a person's words.
- The gateway makes the ship's Slack app from a manifest (`apps.manifest.create`, at most about one a minute): the ship's name as the bot's name, its statement's summary (0047) as the description, a direct messages tab, the events `message.im` and `app_mention`, the bot scopes to read those and to post (`chat:write`, `im:history`, `app_mentions:read`, `reactions:write`), the gateway's events and actions addresses. The signing secret and client credentials go into the vault.
- Then Install opens Slack's install screen; the bot token Slack returns goes into the vault. Where the workspace makes apps wait for an admin's approval, the page says so ("Waiting for your Slack admin"), and Install works once approved.
- The bot is tied to the ship by its id, never its name (L20). A rename updates the bot's name in Slack (`apps.manifest.update`) the next time the gateway reads the ship; until then the page shows both names.
- States on the page per ship: Made, Waiting for install, Waiting for your Slack admin, In Slack, Removed in Slack (`app_uninstalled` or `tokens_revoked`). Remove deletes the app after a confirm. A retired ship's bot is deleted.

### 9.3 Linking a person's Slack account

- From the gateway's Overview, Link Slack: pagasae's sign-in if needed (0054), then Sign in with Slack (OpenID Connect), which gives the Slack user and workspace ids. The link is kept by fleet, Slack workspace and user, and person ship.
- From Slack: an unlinked person who messages or mentions a bot gets an answer only they see: "Link your Slack account to talk to release-notes", with a button to the same flow. Their message is not stored, since it has no sender yet: the answer says to send it again once linked.
- One Slack user links to one account per fleet; a second link is refused, naming the first. Unlink on the Overview. An account with no person ship in the fleet cannot link ("Your account has no person ship in this fleet").
- A disabled account (0055): its person ship is released, its links stop; a message from that Slack user is answered "Your account cannot message the fleet now".
- Linking lets the person talk to bots, and shows a bot ship's messages to them in that bot's conversation (P-B1). Everything else that waits shows in Slack only once they turn Slack on (B5, W8).

### 9.4 A message from Slack into the fleet

1. Slack sends the event to the gateway (`/gw/slack/events`): a direct message to a bot, or a mention of it. The gateway checks the request's signature with that bot's signing secret and rejects a timestamp more than 5 minutes off.
2. It ignores what is not a person's new message: a bot's message (L21), an edit, a deletion, a join.
3. It stores the event in its own database, keyed by Slack's `event_id`, and answers Slack 200 (P-B2). A Slack retry of a stored event is answered 200 and changes nothing. The store is temporary and does not accumulate (Thomas): the event is deleted as soon as core stored or refused the message; after that only its `event_id` is kept, for 1 hour, to answer Slack's retries (at most 3, within about 5 minutes). An event core has not taken within 24 hours is deleted and the person told in the thread: "This message did not reach the fleet; send it again".
4. It finds the ship by the bot's app id and the person ship by the Slack workspace and user, both exact (L20). Unlinked: the link prompt of 9.3.
5. It sends as the person ship, which it crews (L15): to the ship, `text/markdown` with the text (the mention removed, Slack's markup turned into Markdown), a shared file as its Slack link; `inReplyTo` the fleet message a thread replies to, when it replies to one; the idempotency key from `event_id`, so a retry is the same send (L11).
6. Core stores it: the gateway adds a reaction to the person's Slack message, so they see it reached the fleet. Core refuses: the gateway answers in the thread with the reason, plainly: "You may not message release-notes" (no rule), "release-notes was retired".
7. Core does not answer: the gateway sends again with the same key until it does. The reaction is the person's sign; without it, the message is not yet in the fleet.

A mention in a channel works the same: the person who mentions the bot is the sender; the ship's answer goes into that message's thread, where others in the channel see it (B3).

### 9.5 A message from the fleet into Slack

The gateway waits on every person ship it crews (W7). For each delivery to a linked person's person ship:
1. **Where:** a reply to a message that came from Slack goes into that conversation or thread. A message from an exposed ship goes into that bot's direct messages with the person. Anything else goes into the gateway's own bot's direct messages, headed by the sender's name, once the person turned Slack on (B5); with Slack off, it wakes through web push or email as today.
2. **What:** `text/plain` and `text/markdown` as text, Markdown turned into Slack's markup; a question (0038) as its title and context with one button per option, a press sending the answer as the person ship (`inReplyTo` the question); JSON as a code block. Another content type, or a payload over what Slack shows in full (40,000 characters, a block 3,000), goes as a link to the delivery on the gateway's pages.
3. **Hand-over:** the gateway reports `handed` with channel `slack`, posts, keeps the Slack message's id with the delivery, then acks for the person (B4). A link posted for what Slack cannot show is handed only, as a wake.
4. **Answer:** the person replies in the thread under it: sent as in 9.4, `inReplyTo` that message, and the delivery reported handled, as answering on the gateway's page does.
5. **No double wake:** a delivery Slack showed is not fresh, so web push and email do not wake for it (W3, W6).
6. **Slack or the open page (P-B5):** while a page of the person is in focus (W6), their choice While a gateway page is open in focus decides where what Slack would show goes:
   - **Slack** (the default): Slack shows it as steps 1 to 5 say, even while the page is in focus.
   - **The page**: the page shows it: each delivery is handed with channel `page` and nothing is posted in Slack. Handed, it is not fresh, so Slack does not post it when the page leaves focus; it waits on the page until the person handles it. Out of focus, Slack shows it as steps 1 to 5 say.
   - **Both**: Slack posts it as steps 2 and 3 say, handed with channel `page` too, and the gateway holds the acknowledgement while the page is in focus, so it stays on the page until the person handles it there or answers it in Slack (step 4). Out of focus, Slack alone, as steps 1 to 5 say.
   The choice covers every delivery Slack would show, a bot ship's and, with Show everything that waits in Slack on, the others'. With no page in focus it changes nothing.

Unhappy paths:
- Slack answers rate limited: wait its Retry-After, then post again with the same hand-over number, which counts nothing (0040).
- The bot was removed in Slack, or the person's Slack user deactivated: the delivery falls back to the gateway's bot, or to web push and email; the page and the Overview say why.
- The gateway stops after posting and before keeping the Slack message's id: at most one duplicate post, as a wake today. #1165's lesson holds: each delivery is handed and acked one by one, never as a batch whose half is recorded (L23).
- Core refuses the ack: the post stands, and the ack is tried again.

### 9.6 Pages

- **Gateway, Slack** (actors holding `gateway:slack`; others see the state read-only): the workspace and token state, the gateway's bot, the exposed ships with their states, Expose a ship…, Install, Remove, Disconnect. Loading, success (Toast), refusals inline, as part A's pages.
- **Gateway, Overview** (each person): Slack linked as @mathilde in Acme, Unlink; a switch, Show everything that waits in Slack (B5), off until turned on (W8); below it, once linked, a choice of three, While a gateway page is open in focus: Slack, The page, Both (P-B5), Slack until changed. Its caption says what the chosen one does: "Slack: what Slack can show goes to Slack, even while this page is in focus.", "The page: while this page is in focus, what arrives shows here, not in Slack.", "Both: while this page is in focus, what arrives shows in Slack and stays here until you handle it." A change saves at once, a Toast confirms it, a refusal shows inline.
- **Console:** nothing new in 0.33.0.

## 10. Part B: flows

**Set up.** Ana, holding `gateway:slack`, connects the Acme workspace with a configuration token; the gateway makes its bot, Ana installs it. Ana exposes `release-notes`: the gateway makes its app, Ana installs it. In Slack, `release-notes` appears under Apps.
- Unhappy: Slack refuses the token (expired, revoked): "Connect again", nothing made. The workspace needs an admin's approval: Waiting for your Slack admin, Install once approved. Ana lacks manage reach on the ship: refused by name.

**Mathilde asks.** Mathilde, unlinked, messages `release-notes`: only they see "Link your Slack account"; they link in two steps and send again. The gateway stores the event, sends it as Mathilde's person ship, core stores it, the reaction appears. `release-notes` answers; the answer appears in the same conversation, and the delivery is acked.
- Unhappy: Slack retries the event, the same send, nothing new. Core is down: no reaction yet, the gateway sends again until core stores it. No rule lets Mathilde's person ship reach `release-notes`: "You may not message release-notes" in the thread.

**A question from another ship.** `budget-check`, not a bot, asks Mathilde a question (0038). Mathilde turned Slack on: the gateway's bot shows it with its options as buttons; they press one; the answer goes back as their person ship.
- Unhappy: Slack off, so web push wakes them as today. The bot was removed in Slack: falls back to web push and email, and the Overview says so.

**A channel.** In #launch, Joris mentions `release-notes`: Joris is the sender; the answer goes into the thread, everyone in #launch sees it. Another bot's message in the thread is ignored.

## 11. Part B: open points, answered (Thomas, 25 Oct)

| # | Rule |
| --- | --- |
| P-B1 | **Yes: linking lets a person talk to bots both ways**; the Slack switch covers only messages from ships that are not bots. Outcome 4 of the purpose reads: linking turns Slack on for bots |
| P-B2 | **Save first: the gateway stores the event, answers Slack, then sends to core until core stored it.** Thomas: "save first, but this is temporary. Gateway does not cummulate." Kept as 9.4 step 3 says: the event id 1 hour after core took it, an event core has not taken deleted after 24 hours and the person told. Thomas approved the timings: "P-B2 --> approved" |
| P-B3 | **Agent ships and outside A2A agents' proxy ships can be bots; outside MCP servers' proxy ships cannot.** An MCP server reaches Slack through an agent ship that uses its tools, exposed as a bot. Thomas: "ok lets include A2A but exclude mcp. Exposing an mcp to slack through an agent is spinning up a dedicated ship that mediates between mcp and slack but that is the exact agent ship path." |
| P-B4 | **A fleet connects one workspace; a workspace may serve several fleets.** Thomas: "if ever needs change we pick it up then" |
| P-B5 | **When Slack and an open page of the person could both show a delivery, the person chooses** (9.5 step 6, 9.6): Slack, the page, or both; Slack until changed, as built. Thomas (28 Oct): "ok option (z): user preference" |

On P-B3, Thomas asked: "what is the difference between agents ships and proxy ships for the slack bot model?"
- **An outside A2A agent's proxy ship** takes a message and answers, as an agent ship does: the gateway passes a text message on as an A2A message and the agent's answer comes back as a reply (0060). For a Slack bot there is no difference: the same model works with no new part. Its required scopes (part A) are checked on the person ship that sends.
- **An outside MCP server's proxy ship** takes tool calls, a tool's name with JSON arguments, never free text: a person's Slack message has no tool to call. As a bot it would need either a form per tool, built from the tool's input schema, in which the person picks a tool and fills its fields; or an agent ship that reads the person's words and calls the tools, which is an agent ship exposed as a bot, as today.
- So the line is not agent or proxy, but whether the ship takes a message and answers. Agent ships and A2A proxy ships do; MCP proxy ships do not.

## 12. Part B: slices for 0.33.0

All in aeolus-fleet-gateway; core and pagasae unchanged (`handed` takes the channel `slack` as it is).

| # | Slice | Done when |
| --- | --- | --- |
| S5 | Connect a workspace: configuration token in the vault and its rotation, the gateway's bot, `gateway:slack` declared, the Slack page | Tested against a Slack double; refused and expired tokens shown |
| S6 | Expose a ship, an agent ship or an A2A agent's proxy ship (never an MCP server's): app from manifest, install, admin approval, removal in Slack, rename and retire | Each state on the page; ids, never names |
| S7 | Link a Slack account: Sign in with Slack from the Overview and from a first message; unlink; disabled accounts | A second link refused; an unlinked message never stored |
| S8 | Slack into the fleet: events, signatures, the gateway's store, sending as the person ship, retries by `event_id`, threads, reactions and refusals | A Slack retry and a core outage each give exactly one message |
| S9 | The fleet into Slack: where, what, hand-over and ack, answers in threads, questions as buttons, the gateway's bot and the switch, rate limits and fallbacks | Every delivery shown once, handed once; no wake for what Slack showed |

The staging walk uses a real Slack test workspace.
