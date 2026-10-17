# Decision review against the 17 Oct direction

Review by adr-reviewer of every decision in `docs/decisions` against Thomas's direction of 17 Oct 2026. Read only: no decision changes here. Where a decision overlaps the scope rework (`docs/design/scope-rework/scope-rework.md` on `design/scope-rework`), its question numbers are cited as SR<n>.

The direction, as numbered in this review:

1. One fleet, one organisation, one company, many actors; the solo developer space is not the target.
2. Humans, apps and agents connected, secure and managed; no human as the glue; humans gate and steer at critical points.
3. One admin, argo, the operator, manages the whole fleet. A subfleet is a group of ships a person owns inside one network. Crossing between people's ships is normal.
4. Scope is what a ship can do; network (labels) is where it can do it. The PRD ship may direct but cannot start ships.
5. Questions in the console are the wrong direction; a human gets a ship through a plugin or another app. Plugins run their own UI (or micro frontends), not inside the console.

## Verdicts

| Decision | Verdict | Why | What would change |
| --- | --- | --- | --- |
| 0001 Ack on receipt | holds | A gate by a person is execution, not delivery (2). | Nothing. |
| 0002 Ship secrets and scopes | conflicts | Scopes are fixed at commission and carry no bound; `fleet:read` reads every payload and `fleet:manage` acts on any ship, so the where is not the network's (4, 3). SR1, SR2, SR5 and SR14 decide otherwise but are not recorded. | Live grant and revoke, the subset rule, lineage bounds, `fleet:commission` split out (SR part 6); `fleet:read` bound by read reach (SR16). |
| 0003 Postgres is the broker | holds | Promise 2 unchanged (1). | Nothing. |
| 0004 tRPC is the only API door | holds | Apps outside core (5) use the same door; no back door is still the rule. | Only the list of fleet actions on REST and MCP grows with what those apps call. |
| 0005 Prefixed ids | holds | A person or app is a ship (`shp_`). | Nothing. |
| 0006 Payloads max 64 KB | holds | An app ship (CRM) answers with a reference, as any ship (2). | Nothing. |
| 0007 Every record belongs to a fleet | holds | One company is one fleet; a person is not a tenant (1, 3). | Nothing. |
| 0008 Seven packages | holds with a change | Plugin UIs run apart (5), and the app where a person crews a ship lives outside core (SR28). | Each plugin package carries its UI; the person's app is a new package or repo; the console package narrows to argo's administration. |
| 0009 Stack | holds | Nothing in the direction touches it. | Nothing. |
| 0010 Leases until released | holds | A person's ship crewed by an app's server holds one lease as any crew (2). | Nothing (see question B). |
| 0011 Release via trusted publishing | holds | Follows the package list of 0008. | A new package joins the published list if 0008 changes. |
| 0012 Operator is the ship argo | holds with a change | One admin argo holds (3). The operator inbox as the place every question lands, and "Better Auth if several human users ever come", assume argo is the only human (2, 5). | argo's inbox is the admin's only; people crew their own ships from their own app, not a console login (SR15 as changed by 0.6, SR28); a new kind for a person's or app's ship (question A). |
| 0013 Breaking changes before 1.0.0 | holds | Makes the rework affordable. | Nothing. |
| 0014 Strict TDD | holds | Process only. | Nothing. |
| 0015 Identity per conversation and folder | holds | Agent sessions keep it; an app's server keeps its ship's crew token as any crew (2). | Nothing. |
| 0016 No policy | holds with a change | The subset rule (SR2) and lineage bounds (SR5, SR14) are rules core enforces; "secure and managed" (2) needs them stated as part of scopes, not policy. | Record the subset rule and bounds as what a scope means, as 0037 records its limits as an exception for speed. |
| 0017 Squadrons package | holds with a change | Squadrons' pages run in the console through its server (5); its management ship acts on the whole fleet (3, 4); a flagship tells argo, not the forming ship (SR10). | Squadrons serves its own UI and checks argo with `console.session` (SR30); `fleet:manage` bound to ships it commissioned (SR14); flagship proxies to the forming ship (SR10). |
| 0018 Model and harness | holds with a change | Model is required on every send but argo's; a person's ship or an app ship (CRM) runs no model (2). | Model required only for agent sessions; harness of a person's app is free text as today (question A). |
| 0019 Starting prompt presentation | holds | A person's app is one more client reading `secret` (5). | Nothing. |
| 0020 Installation | holds | One hosted fleet per company is the B2B shape (1). | Nothing. |
| 0021 Squadrons installation | holds | Per fleet switch fits one fleet per company (1). | Nothing. |
| 0022 Viewer ship | holds | A read-only look at argo's console, the hosted demo (SR 0.6). | Its read reach is the whole fleet once reading follows reach (SR16). |
| 0023 Notices | holds | Installation to argo's console and viewers (SR 0.6). | Nothing; a person's app shows its own. |
| 0024 Guide | holds | Same as 0023. | Nothing. |
| 0025 Console analytics | holds with a change | `squadron_formed` is a console event for a page that leaves the console (5). | The event moves with squadrons' UI or goes. |
| 0026 Trierarch | holds with a change | Crashed reports and "what a release discards" go to argo only (2, 3); any fitting machine may crew any person's ship (2). | Tell the person whose ship it is as well (SR22); placement across people's machines (question C). |
| 0027 Crew settings | holds | Settings already carry machine labels a requester can use (3). | Nothing. |
| 0028 Report details | holds | Status, not people. | Nothing. |
| 0029 Crew request | holds with a change | Unassigned is argo's to-do only (3); `fleet:manage` writes a request for any ship (4). | The person whose ship it is is told too (SR22); requester bound to ships it commissioned (SR14). |
| 0030 Trierarch plugin | holds with a change | Machines page rendered by the console (5); placement ignores whose ship and whose machine (2, 3); holds `fleet:manage` for commissioning only (4). | Own UI (SR30); `fleet:commission` and `crew:run` instead of `fleet:manage` (SR part 6); placement question C. |
| 0031 Labels | holds with a change | Only the owner assigns a value; SR20 (b) has core copy argo's `subfleet` value to a new ship at commission, and SR5 bounds `labels:assign` (3, 4). | Record the copy at commission as the one assignment not by the owner, or pick SR20 (a). |
| 0032 Clear request | holds | Machine side only. | `fleet:manage` bound by SR14 only. |
| 0033 Console logic on the server | holds with a change | The rule holds for argo's console; the parts on calling squadrons and the trierarch plugin go when their UIs run apart (5). | Drop the plugin client parts once SR30 lands. |
| 0034 Network rules | holds with a change | The network says where (4), but rules cover only send; reading is fleet-wide; an app is reachable only as a ship (2). | A verb per rule, read beside send (SR16 to SR18); apps as ships under the same rules (SR25). argo past every rule stays (3). |
| 0035 Networking plugin | holds | Rules only through a plugin, argo's to connect (3). | Nothing; the default for a company fleet is question D. |
| 0036 Networking plugin package | holds with a change | The rule editor lives in the console (5). | Rule editing in the plugin's own UI; reach graph and refusals stay in argo's console (SR 0.6, SR30). |
| 0037 Declared network rules | holds | Owners keep their group's reach (3). | Nothing; SR20 keeps the subfleet in argo's rules. |
| 0038 Questions | conflicts | Questions answered in argo's console inbox, every question to argo (5); a person, not argo, gates their own ship's work (2, 3). | Question UI leaves core for a person's app; the asker asks the person its ship belongs to (SR26); content type stays or moves (SR29); protocol rules 4 and 5 change. |
| 0039 Sessions in containers | holds | Containment per session serves "secure" (2). | Nothing (keys per repository per machine meet question C). |
| 0040 Delivery protocol | holds with a change | Promise 2 holds; not handled and overdue go to argo's Needs attention only (2, 3). | Tell the person whose ship it is by a message (SR22 as changed by 0.6); argo keeps Needs attention. |
| 0041 Fleet health | holds | Installation and argo's administration (3). | Nothing. |
| 0042 Stuck deliveries | holds with a change | Waiting for crew counts a ship awaiting crew as stuck; a person's ship whose person is away would read as stuck (2). | Depends on how a person's ship is crewed (question B). |

Counts: holds 25, holds with a change 15, conflicts 2, obsolete 0.

## Conflicts and changes, by impact

1. **Questions in the console (0038, 0012).** Direction 5 rejects them outright; direction 2 sends each question to the person who owns the work. Touches what just shipped: #870/#871 (answers never lost unseen), #512, #849 (open), #854, #869; `features/inbox`, `lib/questions.ts`, `question-answer.ts`, `questions-actions.ts`; `core/src/adapters/trpc/ship-protocol.ts` rules 4 and 5; `plugins/aeolus/scripts/aeolus-ask.sh`; `common/src/schemas/question.ts`. SR26, SR29, SR31.
2. **Reading is not under the network (0034, 0002).** `fleet:read` reads every payload, so the where of direction 4 holds for send only; an app such as the CRM leaks through any reader. Touches core's read procedures, `fleet.follow`, `fleet.events`, the viewer, and every plugin reading through `fleet:read`. SR16 to SR18, SR25.
3. **Scopes fixed and unbound (0002, 0016).** SR1, SR2, SR5, SR14 are decided but the decisions still say never changed and any ship. Touches the scope check in core, Connect (`lib/connect-plugin.ts`), squadrons and the trierarch plugin scope sets.
4. **Plugin UIs inside the console (0017, 0030, 0033, 0036, 0025, 0008).** Touches `app/(console)/squadrons/**`, `trierarchs/**`, `network` rule editing, `lib/plugin-nav.ts`, `lib/plugin-ships.ts`, `lib/startup-warnings.ts`; packages squadrons, trierarch-plugin, networking-plugin. SR30.
5. **A person or app as a ship (0012, 0018, 0042).** No kind for them, model required on every send, and an absent person reads as stuck. Touches ship kinds in core, the send schema, stuck deliveries (#864, #867). Questions A and B; SR15, SR25, SR28.
6. **Trouble told to argo only (0026, 0029, 0040).** Crashed, needs crew, overdue and not handled reach argo alone. Touches the trierarch's crash report, Needs attention. SR22.
7. **Placement across people's machines (0026, 0030, 0039).** Burak's ship could run on Thomas's machine with Thomas's model login and repository keys. Touches the trierarch plugin's placement. Question C.
8. **Subfleet label copied at commission (0031).** A core assignment by a ship that does not own the label. SR20.

## Questions for Thomas

Only where the direction and the scope rework leave it open.

**A. What kind is a person's ship or an app's ship?** Kinds today: operator, agent, viewer (0012); model required for every ship but argo (0018).
Options: (a) new kinds `person` and `app`, model required only for `agent`; (b) every such ship stays `agent`, model optional for all; (c) stays `agent`, a person's app states a fixed model value.
Pick: (a). The overview keeps a model for every agent with no gaps, and the console and health can tell a person away from a session down without reading labels.

**B. How is a person's ship crewed while the person is away?** 0042 counts a ship awaiting crew as stuck; 0010 allows one lease.
Options: (a) the person's app's server holds the lease, so the ship stays crewed as argo's does and deliveries wait in its inbox; (b) the app crews it while the person is signed in, and a delivery to an absent person is waiting for crew, as today; (c) as (b), but waiting for crew on a person's ship is no cause.
Pick: (a). An absent person is not a fault, the guarantee still ends at their app's ack, and 0042 needs no exception.

**C. May a trierarch on one person's machine crew another person's ship?** 0030 places on any fitting machine; 0039 hands each session that machine's model login and repository key.
Options: (a) the trierarch plugin fits only machines of the ship's subfleet, or machines argo labels as shared; (b) any fitting machine, as today; the requester narrows with machine labels (0027) if it wants; (c) argo decides per machine in the trierarch plugin's configuration.
Pick: (a), in the trierarch plugin only, not core. Crossing is normal for messages (3), but running on someone's machine spends their login and keys.

**D. A company fleet without a networking plugin is all-to-all (0035), reading included once SR16 lands.** Is that still the default?
Options: (a) yes; the hosting service switches the networking plugin on at fleet create, block-all or keep-latest, by 0021's mechanism; (b) core defaults to block-all with no plugin; (c) yes, and the console warns argo while no plugin is connected.
Pick: (a). 0016 holds, and the hosting service is where a B2B default belongs.

**E. Does argo's console keep its questions until a person's app exists?** SR31 asks whether to hold #849; this asks what happens to what shipped.
Options: (a) keep the shipped question surface for argo's inbox until the person's app replaces it, build no more on it; (b) remove it now, questions show as plain messages in argo's inbox; (c) keep it for good as argo's own gate.
Pick: (a). Ships ask argo today and the guarantee needs a place where answers go; removing it before its replacement leaves questions unanswered.
