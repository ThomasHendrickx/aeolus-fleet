# Fine-grained scopes for 0.27.0 (#348, #600, #866)

Design proposal by designer-2. Thomas answered questions 1 to 10 (part 5); part 6 is the scope catalogue with those answers applied. Questions 11 to 14 are new and open.

Diagrams in this folder: `1-model-a.png`, `2-model-b.png`, `3-model-c.png`, `4-forced-delivery.png`, `5-squadron-forming.png` (sources in `src/`).

---

## 1. Purpose

**What scopes are for.** A scope is the one way Aeolus says what a ship may do. Every caller is a ship (0012); the server reads its scopes, never the request (0002). Aeolus adds no policy of its own (0016): whatever a scope allows is allowed. So the scopes are the operator's only lever on risk, and they have to be fine enough that the operator never has to give a ship more than it needs.

**Who holds them.**

| Holder | Needs | Must never get |
| --- | --- | --- |
| argo (operator) | everything | |
| viewer | read | any write |
| plugins (squadrons, trierarch plugin, networking plugin) | the fleet actions their job needs, on the ships they run | reach or control over ships that are not theirs |
| trierarch ships | crew the ships assigned to them | crew any other ship |
| orchestrator ships (orchestrator-1, a tech lead) | send, and, when argo grants it: force a message into a running session, form and stand down squadrons | the operator's powers |
| agent ships, squadron members | send and receive | anything else by default |

**A good outcome for 0.27.0.**

1. argo can give orchestrator-1 the right to force a message into a running session without giving it anything else (#866), and take it back.
2. A label owner cannot widen reach to ships that are not its own (#600).
3. A tech lead ship can form and stand down a delivery squadron, under a scope argo granted, without holding `fleet:manage` itself (#348).
4. No scope can be used to create a scope its holder does not have.
5. Little new surface: a one-user product pays for every concept forever.

---

## 2. Today

### The scopes

Nine, one list: `SCOPES` in `packages/common/src/fleet/index.ts:10`; the seven commission may add are `FLEET_SCOPES` (line 23). Stored on the ship (`ships.scopes`), returned with the crew token lookup, never changed after commission (0002).

| Scope | What it allows (where) |
| --- | --- |
| `messages:send`, `messages:receive` | every agent ship; send, receive, ack (`packages/core/src/adapters/trpc/ship.ts`) |
| `fleet:read` | list, ship, timeline, messages, labels, health, follow, events (`fleet.ts`) |
| `fleet:manage` | commission (with any fleet scopes), rename, release, re-crew, retire any ship, ping, resend, dismiss, crew requests, clear worktree |
| `crew:assign` | assign crew requests, explain why none fits (0029) |
| `crew:run` | only for requests assigned to its ship: starting prompt, release, status, give back, clear requests (0029, 0032) |
| `labels:define` | define, change, delete its labels; declare network rules on them (0031, 0037) |
| `labels:assign` | assign and unassign the values of labels it owns, **on any ship** (0031) |
| `fleet:network` | register as networking plugin, set rules (only the registered one), read declared rules (0034, 0035, 0037) |

Beside scopes, a few calls are argo's by kind, not by scope: `explainReach` and `reachRefusals` (`NOT_THE_OPERATOR_SHIP` in `packages/core/src/domain/registry/explain-reach.ts:39`, `read-reach-refusals.ts:19`).

### Who gets them, and how

| Ship | Scopes | Given by |
| --- | --- | --- |
| argo | all nine | fleet creation (`found-fleet.ts`, `initialise-fleet.ts`) |
| viewer | `fleet:read` | installation (0022) |
| agent ship | send, receive, plus any fleet scope ticked | Commission dialog (`packages/console/features/fleet/ui/organisms/commission-dialog.tsx:66`, all seven offered flat) or `fleet.commission` by any `fleet:manage` ship |
| squadrons | `fleet:read`, `fleet:manage`, `labels:define`, `labels:assign` | console Connect (`packages/console/lib/connect-plugin.ts:19`) |
| trierarch plugin | `fleet:read`, `fleet:manage`, `crew:assign`, `labels:define`, `labels:assign` | console Connect (`connect-plugin.ts:22`) |
| networking plugin | `fleet:read`, `fleet:network` | console Connect (`connect-plugin.ts:25`) |
| trierarch ship | `crew:run` | trierarch plugin (`packages/trierarch-plugin/src/core/machines/join-machine.ts:12`) |
| flagship, squadron member | send, receive | squadrons at form |

### Where they are checked

- At the API door, before any use case: `scopedProcedure`, `anyScopeProcedure`, `scopedCrewProcedure`, `scopedCrewCallerProcedure` in `packages/core/src/adapters/trpc/trpc.ts:414-470`, one per procedure in `fleet.ts` and `ship.ts`.
- In the domain, the finer rules: label owner (`assign-label.ts`, `unassign-label.ts`), networking plugin owner (`set-network-rules.ts`), crew requests assigned to the caller (`crew:run` use cases), argo only (above).
- In squadrons: the console session's scopes from `console.session` (`packages/squadrons/src/adapters/trpc/router.ts:101`, `fleet:manage` for every write), and its own ship's scopes at connect (`packages/squadrons/src/core/management/connect.ts:13`, `label-squadrons.ts:66`).
- In the console: writes removed for a session without the scope (`packages/console/lib/access.ts`).

### The gaps the three issues expose

| # | Gap | Issue |
| --- | --- | --- |
| G1 | A ship can grant a scope it does not hold. Any `fleet:manage` ship commissions a ship with any fleet scope (`commission-ship.ts:55`, "any caller with fleet:manage may give them"): squadrons could commission a `fleet:network` or `crew:run` ship. A scope widens itself. | all three |
| G2 | Scopes never change after commission. Giving orchestrator-1 one new right means retiring it and commissioning a new ship; taking one back the same. | #866, #348 |
| G3 | A label owner assigns its labels on any ship, and declares rules on them (0037): it can pull any ship into its reach. | #600 |
| G4 | No ship can form a squadron: squadrons' API takes only a console session, and forming needs `fleet:manage`, so only the operator forms. | #348 |
| G5 | No forced delivery: the computer side hands a message over only while the turn is idle (0040; `docs/trierarch.md` "inbox watch"; `plugins/aeolus/README.md` "The hand-over"). | #866 |
| G6 | `fleet:manage` is coarse: a plugin may release or retire any ship, not only its own. Accepted for squadrons in 0017. Reported, not in scope. | (none) |

---

## 3. Lessons to check against

**Decisions.**

- 0001, 0040: Aeolus distributes, not executes; the promise ends at the agent's confirmation. Forced delivery may change *when* the message is handed over, never what the agent does with it, and never weaken exactly once.
- 0002: scopes live on the server, are never carried by the ship, and the crew token lookup returns them in one query. Keep that: any change of scopes takes effect at the next call.
- 0010: no heartbeats; a forced delivery must not need one.
- 0012: argo holds every scope and is the operator; the only human authority.
- 0016: no policy. Limits on forming (#348 Q2) are configuration, as fleet limits are (0020), never a hidden guard.
- 0017, 0030: Aeolus knows nothing about squadrons. A `squadrons:form` that core understands would break this; core may store and show it, never interpret it.
- 0031, 0037: ownership is the existing safety idea (a label's owner alone assigns it; declared rules only on owned labels). Reuse ownership rather than invent a second idea.
- 0034: reach is checked at send time and is the containment for a rogue ship. A forced send must still pass reach.
- 0013: no compatibility layers; existing ships may be re-granted by argo once.

**Security.**

- Least privilege: argo grants exactly what a ship needs; plugins get only what their job needs.
- A scope never widens itself: a ship may grant only scopes it holds (or, for a plugin's own scope, that it declared). Fixes G1.
- Granting needs its own authority: changing a live ship's scopes is argo's, so a compromised plugin cannot raise itself or its ships.
- Revocation is immediate, as release is today.
- No secret in a message: a ship-formed squadron is crewed by crew requests, never by crew lines carried in a payload (any `fleet:read` ship reads payloads).

**Cost.** One user, one operator. Every new concept shows in the console, the docs, the plugin and the tests. Prefer: few new scopes, one rule that covers many cases, nothing a role table or resource grammar would add unless a real case needs it.

---

## 4. Models

All three share two things: the send carries `force`, and a ship-formed squadron is asked of squadrons by a message (diagram 5), since tRPC stays core's only door and squadrons already is a ship that receives. They differ in what a scope *is*.

### Model A: few new scopes, bounded by ownership (diagram `1-model-a.png`)

Scopes stay verbs. Add only what the issues need, and let the existing idea of ownership bound them.

- **Forced delivery:** a new core scope `messages:force`. Without it a send with `force` is refused FORBIDDEN, nothing stored. With it, reach still applies. A forced message is handed over at once: a busy turn is stopped first (question 3).
- **Labels:** `labels:assign` narrows to the owner's own ship and the ships it commissioned (core already stores the commissioning ship). Squadrons labels only ships it commissioned and itself; the trierarch plugin only trierarch ships it commissioned and itself; argo keeps any ship, as it commissioned none but holds the fleet. A plugin can no longer pull another ship into its reach.
- **Squadron forming:** squadrons declares its namespace `squadrons` and the scopes in it (part 6). Core stores them on ships and shows them; only squadrons interprets them, reading the sender's scopes with `fleet.ship`. The squadron belongs to the ship that formed it: only it or argo stands it down. A blueprint names the scopes each template's ships get, squadrons' own included, so a member may form in turn when its blueprint says so (question 8). The flagship is the forming ship's one contact with the squadron (question 10).
- **Grant and revoke:** argo grants and revokes any scope on a live ship (one event, effective at the next call). At commission, a ship grants only scopes it holds; a plugin may also grant the scopes of its own namespace. Fixes G1, G2.
- **Console:** the ship page lists scopes with the words already used in the Commission dialog, plus an Edit scopes action for argo; a plugin's scopes listed under its namespace and the plugin that declared it. A forced message is marked forced in the timeline.

### Model B: resource-scoped scopes (diagram `2-model-b.png`)

A scope names its object: `labels:assign:squadron`, `messages:force:type=coder`, `squadrons:form:delivery@3`.

- **Forced delivery:** force allowed only to the ships or types named.
- **Labels:** assign only the keys named, but on any ship: the #600 spam stays possible within those keys unless the resource also names ships.
- **Squadron forming:** per blueprint.
- **Grant and revoke:** argo grants scope plus resource; resources may name things that do not exist yet (a key before it is defined, a blueprint before it is tagged).
- **Console:** a scope editor with a small grammar per scope.
- Cost: a grammar in common, matching in every check, every plugin connect writing resource strings. Precise, but more than any case today asks for.

### Model C: roles that bundle scopes (diagram `3-model-c.png`)

Core holds named sets of scopes (operator, plugin, orchestrator, agent, trierarch); a ship gets a role; argo edits roles.

- **Forced delivery:** the orchestrator role holds `messages:force`.
- **Labels:** a role does not narrow *which* ships: the #600 spam stays.
- **Squadron forming:** the orchestrator role holds it.
- **Grant and revoke:** edit the role (every ship of it changes) or move a ship to another role.
- **Console:** a roles page plus a role on each ship.
- Cost: a second concept beside scopes, and a role is a new word the fleet does not have. Solves nothing scopes alone do not.

### Pick: Model A

It answers all three issues with one new core scope, one narrowing that reuses ownership, and one generic way for a plugin's own scope to live on a ship. It fixes G1 and G2, which the other models need too. B can come later for one scope if a real case needs a resource; C solves nothing here.

### The backbone flows of the pick

**Forced delivery** (`4-forced-delivery.png`). Happy path: the sender holds `messages:force`, reach allows, the message is stored before OK. The computer side takes it with a push receive, forced deliveries first (question 4).

- Turn idle: handed over as today; the prompt the line starts confirms it.
- Turn busy, trierarch session (Claude Code or Codex): the trierarch sends the session its interrupt key, so the turn stops; it marks the turn idle itself, as it stopped it; then hands the message over with its number and types the line as a new prompt, which confirms it (question 3).
- Turn busy, hand-crewed session: the watcher has no hold on the terminal and cannot stop a turn, so the hooks confirm at the next tool call (PreToolUse acks, then denies that call with the message as its reason) or at Stop, as a mid-turn hand-over does today. This is the most a hand-crewed session allows.

Unhappy paths: no scope (FORBIDDEN, nothing stored, key unused); reach refuses (NOT_REACHABLE, recorded); a pull ship (force changes nothing, its next receive gets it); the interrupt does not stop the turn within 10 seconds (the line is typed anyway, queued, and the next tool call confirms it); ack refused or unanswered (stays received, handed again with the next number); the session dies (handed again, then once more and not handled, as 0040 says); compaction (the store survives, the next prompt or tool call confirms, exactly once); lease ends (back to pending, attempts kept). A forced delivery runs on the 10 minute clock, busy or not. What happens to the message the stopped turn was working on is question 11.

**Squadron forming by a ship** (`5-squadron-forming.png`). The forming ship sends squadrons' ship `application/vnd.aeolus.squadron.form+json` (blueprint, parameters, idempotency key); the fleet stores it as any message, under reach. Squadrons acks, reads the sender's scopes with `fleet.ship`, checks its limits (configuration, unset is none, question 9) and the blueprint, commissions the flagship and members with the scopes each template names (question 8), writes labels, declared rules and a crew request per member, and answers with the squadron id and the flagship's name. Unhappy paths: no `squadrons:form`; a limit reached; a blueprint that is invalid or names a scope squadrons cannot grant (refused before anything is commissioned, as the existing template checks); a repeat of a key (the first answer again); squadrons off or not connected (the message waits, as any delivery). No secret travels in a message.

**How the flagship proxies (question 10).** After forming, the flagship is the forming ship's one contact with its squadron, and the forming ship is the squadron's one contact outside it.

1. Squadrons keeps with each squadron its forming ship: argo for a squadron formed from the console, otherwise the sender of the form request as the fleet gives it, never a name in the payload.
2. A member never sends to the forming ship. It sends its flagship `application/vnd.aeolus.squadron.relay+json` with its payload. The flagship acks it and sends the forming ship a new message of the same content type: the squadron, the member's ship name and role, the member's message id, and the payload. A payload that does not fit 64 KB with that envelope is refused by the flagship in a reply, asking for a reference.
3. The forming ship answers a relay with a reply to it; the flagship sends that answer to the member as a reply to the member's message. The forming ship may also send the flagship a relay naming a member or a role; the flagship sends it on to that member, or to one ship of the role.
4. What a flagship tells argo today about its squadron (a member late or silent, standing down, stood down) goes to the forming ship instead. For a squadron argo formed nothing changes.
5. Stand down, add member and remove member: the forming ship sends them to the flagship (`squadron.stand-down+json`, `squadron.add-member+json`, `squadron.remove-member+json`); the flagship refuses them from any ship but the forming ship and argo. The operator keeps every action in the console.
6. Reach: flagship and argo always reach each other (0034). Between a flagship and a forming ship that is not argo, see question 12. A forming ship that is retired: question 13.

---

## 5. Decisions and open questions

Questions 1 to 10 carry Thomas's answer as the decision.

1. **argo changes a live ship's scopes.** Decided: (a) argo grants and revokes on a live ship, effective at the next call, with an event. Carried by `scopes:grant` (part 6).
2. **A ship grants only the scopes it holds.** Decided: (a) subset rule; a plugin may also grant the scopes of its own namespace; the trierarch plugin gets `crew:run` itself.
3. **How a forced message enters a busy turn.** Decided: (b) "it is force, it means it needs to act NOW": the trierarch stops the turn, then hands the message over as a new prompt. A hand-crewed session, which nothing can stop from outside, gets it at the next tool call or Stop. Flow above.
4. **Forced before older messages.** Decided: (a) forced first.
5. **`labels:assign` bound.** Decided: (a) the owner's own ship and the ships it commissioned; argo unbounded.
6. **Where plugin scopes live.** Decided: (a), with Thomas's rule: core enforces only the scopes it imposes itself; the mechanism is open for plugins to declare their own; each plugin declares one namespace and can take up only that one (squadrons has `squadrons:<action>`), so it cannot spam namespaces. Format in part 6.
7. **How a ship asks squadrons.** Decided: (a) messages to squadrons' ship, content types `application/vnd.aeolus.squadron.*`.
8. **Members of a ship-formed squadron forming in turn.** Decided: (b) "no policy, the squadron blueprint decides. Else it would be us guessing and putting a security stamp on it." A template names the scopes its ships get; squadrons grants them at commission within the subset rule (scopes it holds, and its own namespace).
9. **Limits on forming.** Decided: (a) "indeed no policy": squadrons' configuration (per fleet, per forming ship, members per squadron), unset is none.
10. **The forming ship and its squadron.** Decided: (a) "scalable, but through the flagship, that ship is the proxy towards the forming ship. When the squadron was created by argo, it is a proxy to argo. If it was by another ship it is that ship." Mechanism above.

New, open:

11. **The message a stopped turn was working on.** A forced message stops a turn that took an earlier, acknowledged delivery. 0040 calls a delivery handled only when its turn ends by itself, and hands it once more only after a turn died.
    Options: (a) handled when the next turn (the forced one) ends by itself: the session still holds the earlier message, and the agent decides whether to go back to it; (b) handed once more after the forced turn, as for a died turn; (c) not handled, shown in Needs attention for Resend or Dismiss.
    Pick: (a). Stopping is not dying; (b) would hand the agent a message it already has, and (c) asks the operator about work the agent can resume.
12. **Reach between a forming ship and its flagship while network rules are in force.** Question 5 keeps squadrons from labelling the forming ship, so squadrons cannot declare that reach itself.
    Options: (a) argo writes it: argo labels the ships it lets form with a label of its own and adds a rule to and from flagships (`squadron-role=flagship`); a flagship is code run by squadrons, not a session, and relays only for its own forming ship, so reaching every flagship gives a forming ship nothing more; (b) core widens the `labels:assign` bound to ships that sent the owner's ship a message, so squadrons labels the forming ship and declares the rule; (c) only the answer exception of 0034: the forming ship always writes first, the flagship only answers.
    Pick: (a). No new core rule, and reach stays argo's; without rules (all-to-all, the default) nothing is needed.
13. **A forming ship that is retired.** A send to a retired ship is refused; a released one just waits for crew.
    Options: (a) the flagship proxies to argo from then on, as for a squadron argo formed; (b) the squadron stands down.
    Pick: (a). The work in flight is not lost, and argo decides.
14. **`fleet:manage` bound** (gap G6, forced by the catalogue). Today it acts on any ship.
    Options: (a) ships it commissioned, argo any; (b) any ship, as today.
    Pick: (a). Squadrons releases, retires and requests crews only for ships it commissioned, and the trierarch plugin needs no `fleet:manage` at all once `fleet:commission` exists, so nothing breaks.

---

## 6. The scope catalogue

### Format

- A scope is `<namespace>:<action>`. Namespace and action: lowercase `a-z`, `0-9` and `-`, starting with a letter, 1 to 32 characters each.
- **Core namespaces**, reserved: `messages`, `fleet`, `crew`, `labels`, `scopes`. Core enforces these, and only these.
- **A plugin namespace**: a ship holding `scopes:declare` declares its namespace and its scopes with `fleet.declareScopes` (`{ namespace, scopes: [{ action, description }] }`), its whole list each time, as `declareNetworkRules` does (0037). Its first declaration takes up the namespace for good; it can never declare another. The description is one line of at most 200 characters, for the console.
- Core stores a plugin's scopes on the ships granted them and answers them wherever it answers scopes (`fleet.list`, `fleet.ship`, `console.session`), so the plugin reads them from the fleet. It never checks them. `fleet.scopes` (`fleet:read`) lists every namespace with its declaring ship and its scopes.
- Core refuses (each refusal named): a malformed scope; declaring a core namespace; a namespace another ship took (CONFLICT, naming it); a second namespace from the same ship; more than 20 scopes in a namespace; removing a scope ships hold (naming them, as label values, 0031); granting a scope nobody declared; granting a core scope the granter does not hold; granting a plugin scope by any ship but argo or that namespace's declarer.
- Retiring the declaring ship retires its namespace: its scopes go from every ship, and the namespace is free again (as labels, 0031). Events: `ScopesDeclared` (declaring ship, namespace, the number of scopes) and `ScopesChanged` (ship, added, removed, by whom).
- Granting: at commission, the commissioner grants scopes it holds and scopes of its own namespace. On a live ship, a ship with `scopes:grant` grants and revokes within the same rule; argo holds everything, so argo grants anything. Every agent ship gets `messages:send` and `messages:receive` at commission.
- Not scopes, unchanged: `explainReach` and `reachRefusals` stay argo's by kind (0034).

### Core scopes

| Scope | Allows | Guards | Bound | Held by default | Granted by |
| --- | --- | --- | --- | --- | --- |
| `messages:send` | send a message, answer one | `send`, `fleet.reply` | as its own ship; reach applies | argo, every agent ship | given with every agent ship |
| `messages:receive` | receive, acknowledge, answer a ping, read its inbox; the computer side's push receive, handed, handled, not handled, turn; argo's read and done | `receive`, `ack`, `pong`, `inbox`, `pushReceive`, `handed`, `handled`, `notHandled`, `turn`, `fleet.markRead`, `fleet.markDone` | its own ship | argo, every agent ship | given with every agent ship |
| `messages:force` | send a message forced: handed over first and at once, a busy turn stopped | `send` with `force` | ships it reaches | argo | argo; a commissioner holding it |
| `messages:resend` | resend or dismiss an undeliverable or not handled delivery | `fleet.resend`, `fleet.dismiss` | any ship | argo | argo; a commissioner holding it |
| `fleet:read` | read the fleet, every payload included | `fleet.list`, `ship`, `shipTimeline`, `shipMessages`, `message`, `shipWay`, `needsAttention`, `overdue`, `noShipCanTake`, `health`, `inbox`, `follow`, `events`, `labels`, `findLabelValue`, `limits`, `clearRequests`, `scopes` | any ship | argo, viewer, squadrons, trierarch plugin, networking plugin | argo; a commissioner holding it |
| `fleet:commission` | commission an agent ship, granting it only scopes the caller may grant | `fleet.commission` | new ships, which count as commissioned by it | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `fleet:manage` | rename, release, crew again, retire, get a starting prompt, ping, request crew and remove the request, clear a worktree | `fleet.rename`, `release`, `recrew`, `retire`, `getStartingPrompt`, `ping`, `crewRequest`, `removeCrewRequest`, `clearWorktree` | ships it commissioned; argo any (question 14) | argo, squadrons | argo; a commissioner holding it |
| `crew:assign` | assign a crew request, say why none fits | `fleet.assignCrew`, `explainCrewRequest` | any crew request | argo, trierarch plugin | argo; a commissioner holding it |
| `crew:run` | for the crew requests assigned to its ship: read them, get the starting prompt, release, write status, give back, confirm a release, read and confirm clear requests | `fleet.assignedCrewRequests`, `getStartingPrompt`, `release`, `reportCrewStatus`, `confirmCrewRelease`, `giveBackCrewRequest`, `clearRequests`, `confirmWorktreeCleared`, `ship` | ships whose request is assigned to its own ship | argo, trierarch ships, trierarch plugin (question 2) | argo; a commissioner holding it (the trierarch plugin) |
| `labels:define` | define, change and delete its labels; declare network rules on them | `fleet.defineLabel`, `changeLabelValues`, `deleteLabel`, `declareNetworkRules` | labels it owns | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `labels:assign` | assign and unassign values of labels it owns | `fleet.assignLabel`, `unassignLabel` | its own ship and ships it commissioned; argo any (question 5) | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `fleet:network` | register as the networking plugin, set the rules (the registered plugin only), read declared rules | `fleet.registerNetworkPlugin`, `unregisterNetworkPlugin`, `setNetworkRules`, `declaredNetworkRules` | the fleet's rules | argo, networking plugin | argo; a commissioner holding it |
| `scopes:declare` | take up one plugin namespace and declare its scopes | `fleet.declareScopes` | its own namespace | argo, squadrons | argo; a commissioner holding it |
| `scopes:grant` | grant and revoke scopes on a live ship | `fleet.grantScopes` | scopes it may grant (above); argo any | argo | argo |

### Scopes squadrons declares (namespace `squadrons`, declared by the plugin, enforced by squadrons only)

| Scope | Allows | Guards | Bound | Held by default | Granted by |
| --- | --- | --- | --- | --- | --- |
| `squadrons:form` | ask squadrons to form a squadron from a blueprint; it then owns it: stands it down, gets its relays | `squadron.form+json` to squadrons' ship; `squadron.stand-down+json` to the flagship | squadrons it formed | none (argo holds it) | argo; squadrons at commission when a template names it (question 8) |
| `squadrons:scale` | add and remove members of a squadron it owns | `squadron.add-member+json`, `squadron.remove-member+json` to the flagship | squadrons it formed | none (argo holds it) | argo; squadrons at commission when a template names it |

argo holds every scope, a plugin's too, and squadrons' console API keeps checking the operator's session as today.

### From today's scopes to these

No compatibility layer (0013): one migration sets every ship's scopes, and the old names stop existing.

| Today | Becomes | Change |
| --- | --- | --- |
| `messages:send`, `messages:receive` | same | unchanged |
| (none) | `messages:force` | new |
| `fleet:manage` (resend, dismiss) | `messages:resend` | split out |
| `fleet:read` | same | unchanged, also guards `fleet.scopes` |
| `fleet:manage` (commission) | `fleet:commission` | split out; grants only what the caller may grant |
| `fleet:manage` (the rest) | `fleet:manage` | narrowed to ships it commissioned |
| `crew:assign`, `crew:run`, `labels:define`, `fleet:network` | same | unchanged |
| `labels:assign` | same | narrowed to its own ship and ships it commissioned |
| (none) | `scopes:declare`, `scopes:grant` | new |

Holders after the migration: argo every core scope; a ship holding `fleet:manage` today also gets `fleet:commission` and `messages:resend`, so it keeps what it did, within the new bounds; squadrons gains `fleet:commission` and `scopes:declare`; the trierarch plugin swaps `fleet:manage` for `fleet:commission` and gains `crew:run`; the networking plugin, trierarch ships and the viewer are unchanged. The console's Connect sets these sets for a new connection.
