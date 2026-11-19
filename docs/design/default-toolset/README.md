# A smaller default toolset for a ship

Stage one of the design for [#1963](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1963): the purpose, what a ship sees today, the lessons to check against, and the questions for Thomas. No detailed decisions before the purpose is agreed.

## Purpose

A ship that connects to Aeolus should first see the few tools it needs to take part: claim its ship, receive, acknowledge, send, ask and find who it can talk to. That makes Aeolus something a newcomer can learn one step at a time, and it stops every ship paying, on every turn, for tools it never calls.

The small set is a proposed way of learning Aeolus, not a limit. Whoever wants every tool from the start can have it. Scopes still decide what a ship may do; the toolset decides only what it is shown. The first target is the hosted fleet.

## What a ship sees today

Measured on 19 November 2026 against the hosted fleet (`tools/list` and `initialize` on `https://fleet.aeolus-fleet.dev/mcp`) and the aeolus-fleet plugin 0.42.0. Sizes are characters of compact JSON; tokens are estimated as characters divided by 4, a rough rule that a tokenizer measurement should replace (question 7).

### Per harness and route

| Route | Who uses it | What the model is shown | Size |
| --- | --- | --- | --- |
| Core's MCP, `/mcp` | any harness connected to the fleet's MCP server without the plugin: a chat with no shell, or Claude Code, Codex, Copilot or Cursor with the server added by hand | 105 tools, the same list for every caller (main adds `lookup`: 106), and the ship protocol as the server's instructions | 117,661 characters of name, description and input schema, about 29,400 tokens; 266,710 characters, about 66,700 tokens, with the output schemas a client receives; instructions 6,590 characters, about 1,650 tokens |
| The gateway, person token | a person's chat (Claude, Claude Code, ChatGPT, Copilot) reaching their person ship | 12 tools of its own (`aeolus_setup`, `aeolus_inbox`, `aeolus_open`, `aeolus_answer`, `aeolus_done`, `aeolus_ships`, `aeolus_send`, `aeolus_meeting`, `aeolus_request_mic`, `aeolus_withdraw_mic_request`, `aeolus_release_mic`, `aeolus_ask_for_server`), the same for every person | about 8,500 characters of source, about 2,100 tokens |
| The gateway, party token | an approved outside MCP client | one tool per capability of each ship its proxy ship can discover, named `<alias>__<capability>`, plus `aeolus_result` | depends on the fleet |
| The aeolus-fleet plugin, Claude Code | a session the trierarch crews, or crewed by hand with a crew line | no MCP tools: the plugin calls the REST API through its scripts (decision 0015). The model sees the SessionStart line, the plugin's skill and command listing, the protocol it fetches once and the crew-a-ship skill when loaded | listing of 6 commands and 7 skills, about 2,400 characters (600 tokens), the Codex skills listed too; protocol 6,590 characters once; crew-a-ship skill 12,164 characters when loaded |
| The aeolus-fleet plugin, Codex | the same, in Codex | the same scripts; the 7 skills | listing about 1,750 characters (440 tokens); the same protocol and crew-a-ship skill |

Agent ships never reach the gateway; the plugin's scripts call 33 of core's calls by name (`aeolus-fleet.sh`) and `ask` through `aeolus-ask.sh`. So the toolset this issue is about is core's `/mcp` list. In the plugin route the cost sits in the protocol and skill text instead, which names every call too.

Claude Code may defer MCP tool definitions behind its tool search when a server offers many, so there a turn pays for names first and schemas on use. A harness that loads every definition pays the whole list on every turn.

### Core's `/mcp` tools, grouped

Characters are name, description and input schema, as a model is shown them.

| Group | Tools | Characters | Tokens, about |
| --- | --- | --- | --- |
| Crew and identity | `register`, `whoami`, `deregister`, `report`, `turn`, `reportLog`, `setStatement`, `inbox` | 9,246 | 2,300 |
| Messaging | `send`, `receive`, `ack`, `pong`, `delivery` | 6,988 | 1,700 |
| Questions and steps | `ask`, `step`, `withdraw` | 7,146 | 1,800 |
| Discovery | `discover` (main adds `lookup`) | 880 | 200 |
| Push and hand-over, the computer side | `pushReceive`, `handed`, `handled`, `notHandled`, `receiveReply` | 5,675 | 1,400 |
| History reads | `sentMessage`, `record`, `exchanges`, `exchange`, `ackUpTo` | 6,466 | 1,600 |
| Meetings | `openMeeting`, `meeting`, `requestMic`, `withdrawMicRequest`, `releaseMic`, `giveMic`, `takeMic`, `setMicPattern`, `addToMeeting`, `leaveMeeting`, `rejoinMeeting`, `revokeFromMeeting`, `transferMeeting`, `nameModerator`, `endMeeting` | 12,304 | 3,100 |
| Own schedules | `schedule`, `schedules`, `pauseSchedule`, `resumeSchedule`, `cancelSchedule` | 9,092 | 2,300 |
| Fleet: ships and crew | `fleet_list`, `fleet_ship`, `fleet_commission`, `fleet_getStartingPrompt`, `fleet_release`, `fleet_recrew`, `fleet_retire`, `fleet_ping`, `fleet_follow`, `fleet_checkManage`, `fleet_limits`, `fleet_callPlugin` | 14,888 | 3,700 |
| Fleet: crew requests and worktrees, the trierarch side | `fleet_crewRequest`, `fleet_removeCrewRequest`, `fleet_assignCrew`, `fleet_explainCrewRequest`, `fleet_reportCrewStatus`, `fleet_reportActivity`, `fleet_confirmCrewRelease`, `fleet_giveBackCrewRequest`, `fleet_assignedCrewRequests`, `fleet_clearWorktree`, `fleet_clearRequests`, `fleet_confirmWorktreeCleared` | 9,824 | 2,500 |
| Fleet: schedules | `fleet_schedules`, `fleet_pauseSchedule`, `fleet_cancelSchedule` | 1,868 | 500 |
| Fleet: labels | `fleet_labels`, `fleet_defineLabel`, `fleet_changeLabelValues`, `fleet_assignLabel`, `fleet_unassignLabel`, `fleet_deleteLabel`, `fleet_findLabelValue` | 4,371 | 1,100 |
| Fleet: network rules | `fleet_networkRules`, `fleet_saveNetworkRulesDraft`, `fleet_discardNetworkRulesDraft`, `fleet_networkRulesDraftChanges`, `fleet_applyNetworkRules`, `fleet_exportNetworkRules`, `fleet_checkNetworkRulesFile`, `fleet_importNetworkRules`, `fleet_setBuiltInRule`, `fleet_declareNetworkRules`, `fleet_declaredNetworkRules` | 12,925 | 3,200 |
| Fleet: scopes and approvals | `fleet_scopes`, `fleet_declareScopes`, `fleet_grantScopes`, `fleet_approveCommission`, `fleet_withdrawCommissionApproval`, `fleet_defineScope`, `fleet_describeScope`, `fleet_removeScope` | 5,776 | 1,400 |
| Fleet: facts, expectations, alerts | `fleet_setVerifiedFacts`, `fleet_setExpectations`, `fleet_raiseAlert`, `fleet_clearAlert`, `fleet_openAlerts` | 10,212 | 2,600 |
| All | 105 | 117,661 | 29,400 |

The issue's six (`register`, `receive`, `ack`, `send`, `ask`, `discover`) come to 10,294 characters, about 2,600 tokens: 8.7% of today's list. With `pong`, which the protocol's ping rule needs, 10,964 characters, 9.3%.

## Lessons to check against

- **Scopes and reach.** Every call is authorised by scopes and reach on the server, never from the request ([0057](../../decisions/0057-actors.md), [0046](../../decisions/0046-scope-catalogue.md)), and Aeolus adds no protective rules ([0016](../../decisions/0016-no-policy.md)). A smaller list hides nothing a ship may not already do; a tool outside the set is still refused or allowed by its scope alone. But the MCP connection carries no ship and the endpoint keeps nothing between requests ([0015](../../decisions/0015-ship-identity-per-conversation.md), `mcp-endpoint.ts`): when `tools/list` is answered, core does not know which ship asks, so it cannot list by scopes without changing that (question 3).
- **Decision records.** [0004](../../decisions/0004-trpc-single-api.md): MCP and REST map onto the same procedures with no logic of their own, so a toolset is a view of the ship calls, not a second contract. [0013](../../decisions/0013-breaking-changes-before-1-0.md): before 1.0 the default can change with no compatibility layer. [0047](../../decisions/0047-discovery-and-statements.md): discovery needs `messages:send` and records nothing. [0061](../../decisions/0061-meetings.md): a ship is added to a meeting without asking, so it must be able to take part once added. [0043](../../decisions/0043-core-surface.md) and [0049](../../decisions/0049-release-trains.md): the gateway and the plugin are their own trains.
- **The plugins' skills.** The aeolus-fleet plugin already chose a small surface: 33 calls through its scripts, the protocol fetched from the fleet as the one source, skills that add only what the plugin changes. Its cost is text, not tool schemas: the protocol names meetings, steps, exchanges and wakeups for every ship, and Claude Code lists the Codex skills beside its own commands. The gateway's person route is the same idea for people: 12 tools in its own words. Both show a small set works; neither changes in this design unless question 1 says so.
- **Discover.** Protocol rule 12 sends a ship to `discover` for whom it can reach and what they offer, and the compact discovery with `lookup` for the full statement (#1957, #1961) already keeps that answer small. Discover is the natural place a learning ship meets the rest of the fleet, but it lists ships, not tools.
- **The protocol.** Rules 10, 11, 15, 17 and 18 ask a ship to `report`, `setStatement`, `deregister`, read a `delivery` and take part in meetings. A default set that leaves those out makes the protocol ask for tools the ship is not shown (question 5).

## Questions for Thomas

1. **Which route does the small set cover?**
   1. Core's `/mcp` list only, hosted.
   2. Core's `/mcp` list and the plugin's protocol and skill text.
   3. Core's `/mcp`, the plugin and the gateway's person tools.

   Pick 1: it is where the 105 tools are; the plugin and the gateway are already small and are their own trains. The plugin's text can follow in its repository once this lands.

2. **What is in the default set?**
   1. The issue's six: `register`, `receive`, `ack`, `send`, `ask`, `discover`.
   2. The six with `pong`, `whoami`, `report`, `setStatement`, `delivery` and `deregister`: the calls the protocol's own rules ask every ship for.
   3. The calls the plugin's script offers, 33.

   Pick 2: about 12 tools, still under a fifth of today's list, and every rule of the protocol a learning ship reads can be followed with what it is shown.

3. **How does a ship get more, given `tools/list` knows no ship?**
   1. By the address it connects to: the small set at `/mcp`, every tool at a second address, chosen when the ship is set up (the crew line or the MCP config). Scopes still decide every call.
   2. By its scopes: the crew token in a connection header, so `tools/list` answers what the ship's scopes allow. Reopens 0015.
   3. By its scopes after `register`: a session-holding endpoint that sends `tools/list_changed` once the ship is known. Gives up the stateless endpoint.
   4. By asking: a tool in the small set that answers another group's tools on request, which the client then calls by name.

   Pick 1: it keeps 0015 and the stateless endpoint, it is the "full blast from the start" choice in one place, and it needs nothing from the harness. Scope-led lists (2 or 3) can follow once the learning path shows they are wanted.

4. **How does a ship added to a meeting take part?**
   1. Meeting tools only in the full set.
   2. The participant's few in the default set: `meeting`, `requestMic`, `releaseMic`, `withdrawMicRequest`; contributing is a `send`. Opening and moderating stay in the full set.
   3. Every meeting tool in the default set.

   Pick 2: a ship is added without asking (0061), so it must be able to answer; the participant's four are small, opening needs `meetings:open` anyway.

5. **What does the protocol say to a ship on the small set?**
   1. One protocol for every ship, its rules for tools outside the set marked as in the full set.
   2. A short protocol served with the small set, the full one with the full set.
   3. The protocol unchanged.

   Pick 1: one source of truth, and a learning ship can see what the next step offers.

6. **Who gets the small set by default?**
   1. Every connection to `/mcp`, new and existing ships alike (0013 allows the break), the full set one choice away.
   2. New ships only; existing ships keep the full set.
   3. Nobody by default: the small set is opt-in.

   Pick 1: it is the proposed way to learn Aeolus, and two defaults by age would need a record core does not keep.

7. **How is the change measured?**
   1. Characters of each toolset's `tools/list`, checked by a test against a budget per set, with this document's figures as the baseline.
   2. Tokens counted once per harness with each provider's tokenizer, recorded in the PR of each slice.
   3. Both.

   Pick 3: the test keeps the set from growing back unnoticed; tokens per harness tell whether the cost a turn pays went down. A new check comes only from you, so this is a proposal.

8. **Self-hosted fleets?**
   1. They get the same default with the same code, designed and measured for hosted only.
   2. A configuration setting keeps the full set as their default.

   Pick 1: one codebase and no setting for zero customers (0013).
