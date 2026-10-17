# Fine-grained scopes for 0.27.0 (#348, #600, #866)

Design proposal by designer-2. No code, no decision taken: the picks below are proposals, and the numbered questions in part 5 are Thomas's to answer.

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

- **Forced delivery:** a new core scope `messages:force`. Without it a send with `force` is refused FORBIDDEN, nothing stored. With it, reach still applies.
- **Labels:** `labels:assign` narrows to the owner's own ship and the ships it commissioned (core already stores the commissioning ship). Squadrons labels only ships it commissioned and itself; the trierarch plugin only trierarch ships it commissioned and itself; argo keeps any ship, as it commissioned none but holds the fleet. A plugin can no longer pull another ship into its reach.
- **Squadron forming:** a scope squadrons declares, `squadrons:form`. Core stores it on a ship and shows it, as it shows any scope; only squadrons interprets it, reading the sender's scopes with `fleet.ship`. The squadron belongs to the ship that formed it: only it or argo stands it down.
- **Grant and revoke:** argo grants and revokes any scope on a live ship (one event, effective at the next call). At commission, a ship grants only scopes it holds; a plugin may also grant the scopes it declared. Fixes G1, G2.
- **Console:** the ship page lists scopes with the words already used in the Commission dialog, plus an Edit scopes action for argo; plugin scopes listed under the plugin that declared them. A forced message is marked forced in the timeline.

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

### The two backbone flows of the pick

**Forced delivery** (`4-forced-delivery.png`). Happy path: the sender holds `messages:force`, reach allows, the message is stored before OK. The computer side (trierarch or plugin watcher) takes it with a push receive, hands it first and whatever the turn, and reports `handed` with its number. The hooks confirm it at the next tool call (PreToolUse acks, then denies that tool call with the message as its reason, as a mid-turn hand-over already does today), or at Stop when the turn makes no tool call. Unhappy paths: no scope (FORBIDDEN, nothing stored); reach refuses (NOT_REACHABLE, recorded); a pull ship (force changes nothing, the next receive gets it); ack refused or unanswered (stays received, handed again with the next number); the session dies (handed again, first prompt confirms, then once more and not handled as 0040 says); compaction mid-turn (the store survives, the next tool call confirms, exactly once); lease ends (back to pending, attempts kept). The overdue clock for a forced delivery is the idle one (10 minutes) even while busy, since it should have been handed at once.

**Squadron forming by a ship** (`5-squadron-forming.png`). The tech lead sends squadrons' ship a form request (blueprint, parameters, idempotency key); the fleet stores it like any message, under reach. Squadrons acks, reads the sender's scopes, checks its limits and the blueprint, commissions with its own `fleet:manage`, writes crew requests, and answers with the squadron id. Unhappy paths: no `squadrons:form`, limit reached, blueprint invalid (refused, nothing formed); repeat of a key (the first answer again); squadrons not connected or off (the message waits, as any delivery to a ship without crew); not the owner on stand down (refused). The tech lead never holds `fleet:manage`, and no secret travels in a message.

---

## 5. Questions for Thomas

1. **May argo change a live ship's scopes?** 0002 says scopes never change after commission, and the blueprint lists operator-editable scopes as later. Without it, every grant of `messages:force` or `squadrons:form` means retiring and commissioning the ship again.
   Options: (a) argo grants and revokes on a live ship, effective at the next call, with an event; (b) keep scopes fixed, retire and commission again.
   Pick: (a). Revoking at once is the security win; nothing else needs it to be fixed.

2. **May a ship grant only the scopes it holds?** Today any `fleet:manage` ship grants any fleet scope (G1). The trierarch plugin grants `crew:run`, which it does not hold.
   Options: (a) subset rule, plus a plugin may grant the scopes it declared; the trierarch plugin gets `crew:run` itself (it reads only requests assigned to its own ship, so it gains nothing); (b) keep 0016 as it stands.
   Pick: (a). A scope that widens itself defeats every other scope.

3. **How does a forced message enter a busy turn?** The issue names two ways.
   Options: (a) at the next tool call, through the hooks that confirm a mid-turn hand-over today, works for trierarch and hand-crewed sessions alike; (b) also stop the turn (the trierarch sends the interrupt key), which only a trierarch can do and which ends the agent's work mid-step; (c) the sender chooses per message between (a) and (b), with (b) needing a second scope.
   Pick: (a). It needs no new mechanism, keeps Aeolus from stopping work, and a turn that makes no tool call ends soon anyway (Stop confirms).

4. **Does a forced message go before older waiting messages of the same ship?** 
   Options: (a) yes, forced first; (b) no, in order, only the turn no longer matters.
   Pick: (a). "Read this now" behind three older messages is not now.

5. **Is `labels:assign` bounded to the owner's own ship and the ships it commissioned?** This changes 0031 ("on any ship"), which Thomas set on #573 so a plugin's own ship belongs to its group: that still holds.
   Options: (a) bounded, argo unbounded; (b) a separate `labels:assign` on any ship that only argo may grant; (c) keep 0031, close #600 with visibility only.
   Pick: (a). It ends the spam with no new scope, and both plugins only label ships they commissioned.

6. **Where does `squadrons:form` live?** 0017: Aeolus knows nothing about squadrons.
   Options: (a) a plugin declares the scopes it reads; core stores them on ships, shows them under that plugin and interprets none; (b) a core scope `squadrons:form`; (c) squadrons keeps its own list of ships that may form, edited on its pages.
   Pick: (a). One place to see what a ship may do, and core stays ignorant of squadrons.

7. **How does a ship ask squadrons to form and stand down?**
   Options: (a) a message to squadrons' ship (content types under `application/vnd.aeolus.squadron.*`), squadrons answering by reply; (b) a ship-facing squadrons API that checks crew tokens.
   Pick: (a). Durable by the fleet's promise, sender known from the server, under reach, and no crew token leaves the fleet.

8. **May a ship-formed squadron's members form squadrons in turn?**
   Options: (a) never: squadrons gives no member of a ship-formed squadron `squadrons:form`, so depth is one; (b) the blueprint decides, argo vetting the template repositories; (c) a depth limit as configuration.
   Pick: (a). No spawning chains; argo can still grant a member the scope by hand.

9. **Limits on forming?** Every member is a running session (#348 Q2, Q5).
   Options: (a) squadrons' configuration: squadrons per fleet and per forming ship, members per squadron, unset is none, as fleet limits (0020); (b) none (0016).
   Pick: (a). Configuration, not policy; argo sees each formed squadron with its owner.

10. **Does every message a ship-formed squadron sends reach the tech lead?** Today squadrons declares `squadron=#` to `squadron=#` and flagship to and from itself.
    Options: (a) squadrons also labels the forming ship with that squadron's value, so it reaches the flagship and the flagship reaches it; (b) only replies (the answer exception of 0034).
    Pick: (a). The tech lead must be able to steer its squadron; this stays within labels squadrons owns, and the forming ship is not one it commissioned, so question 5 needs this one exception for the ship that formed it.

Not done, noticed: `fleet:manage` lets a plugin release or retire any ship (G6); bounding it to ships the plugin commissioned would follow the same rule as question 5, and is worth its own issue.
