# Model governance: the models a fleet may run

Design for [#375](https://github.com/ThomasHendrickx/aeolus-fleet/issues/375), Aeolus 0.32.0. Docs only. Stage 1: purpose, lessons, questions. Nothing here is decided until Thomas answers.

## 1. Purpose

A fleet's operator says, in one place, which models the fleet's agent ships may be crewed with. Machines keep saying what they can run (#365); the fleet's choice of what it may run sits on top of that, held by the trierarch plugin, never by the machines (Thomas, #375).

For whom: the operator and the fleet managers who answer for what the fleet's sessions cost and which vendors' models they use. Second: everyone who requests a crew, who should only be offered what they may pick.

A good outcome:
1. A fleet that sets nothing behaves exactly as today (opt-in, empty by default, #375).
2. No new session starts on a model the fleet disabled, whichever door the crew request came through (console, MCP, REST, a squadron's template).
3. A crew request held back for it says so: the reason "model disabled" in the operator's needs-crew to-do, as any placement reason.
4. The console's crew forms (request a crew, commission, form a squadron) leave disabled models out.
5. Nothing running is stopped (#375).

Not the purpose: proving which model a session really runs (self-reported, 0018); limits or budgets per model; choosing models across fleets (that would be policy for everyone, #365 investigation); changing what a machine reports.

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Aeolus adds no protective rules unless the operator asks. So this is the operator's own rule, opt-in, empty by default. | [0016](../../decisions/0016-no-policy.md); #375 |
| L2 | What a machine can run is detected and never filled in by hand; a model the harness refuses is dropped for that harness version. Governance filters on top of the report, never edits it. | #365, #382, #392; aeolus-fleet-trierarch `docs/trierarch.md`, "Detected options" |
| L3 | The plugin's database holds per fleet only its connection and switch. Storing the fleet's choice there amends 0030; Thomas picked that over a fleet setting in core. | [0030](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/decisions/0030-trierarch-plugin.md); #365 investigation, section 4, pick (a); #375 |
| L4 | Core never acts on crew settings: a request naming any model is accepted. Why it waits is placement's to write, a reason of at most 200 characters (`CrewRequestExplained`), rewritten only when it changes. So the plugin is the one guard; the console forms are a convenience. | [0029](../../decisions/0029-crew-request.md); trierarch plugin `core/assignment/placement.ts` |
| L5 | A declared option with a value the harness does not offer does not fit: "running another model silently would be wrong". | [0027](../../decisions/0027-crew-settings.md); #366 |
| L6 | A request may name no model. Claude Code's model option has no default, so the session runs whatever the harness picks; Codex's default is the model in its `config.toml`, else the first confirmed one. | `docs/trierarch.md`, "Detected options" |
| L7 | Model ids change with each harness release: Claude Code's aliases (`fable`, `opus`, `sonnet`) resolve to the latest exact id of their family, and machines on different versions report different ids. | `docs/trierarch.md`, "Detected options"; #383 |
| L8 | The model a ship states is self-reported. The plugin already compares it with the request's model and tells argo once, observing only. | 0018; trierarch plugin `core/assignment/tell-model-mismatches.ts` |
| L9 | A final assignment is never moved; a request given back before then is placed again, leaving out the trierarchs that gave it back. | 0030; 0029 |
| L10 | Requests reach the fleet through more than the console: `fleet_crewRequest` over MCP and REST, and squadron templates with `crew.model`. | 0004; #387 |
| L11 | The three crew forms build their model list from the machines' reports alone, as the union of each harness's `model` values (`offersOf`). | `packages/console/lib/crew-settings-form.ts` |
| L12 | The plugin's state-changing calls take `fleet:manage`, through the console session checked against the fleet. | trierarch plugin `adapters/trpc/router.ts` (`managing`) |
| L13 | Before 1.0.0, keep it minimal: no compatibility work. | [0013](../../decisions/0013-breaking-changes-before-1-0.md) |

## 3. Questions

**Q1. What the operator turns off: which kind of list.**
1. A list of disabled models. Empty means nothing changes; a model new to the machines is allowed until someone disables it.
2. A list of enabled models, used only once it holds one. A model new to the machines stays out until someone enables it.
3. The operator picks one of the two per fleet.

Pick 2: governance that lets a newly released, dearer model in by default does not govern; and with "unset means all" it is still opt-in and empty by default (L1). Option 1 if Thomas wants new models to arrive without an operator step. Option 3 is two rules where one will do (L13).

**Q2. What an entry names** (L7).
1. An exact model id, as the machines report it (`claude-opus-5-5`).
2. A family that covers its future ids too (`opus`, `gpt-5`), matched by the plugin.
3. Both.

Pick 1: it is the id every send states and the plugin already compares (L8), and it needs no matching rules of Aeolus's own. The cost: with Q1 option 2, each new release needs one click. Option 2 if Thomas finds that click a burden; it brings a name list the plugin must keep true across vendors.

**Q3. A request that names no model** (L5, L6), while the fleet has a rule.
1. Placed as today: the rule covers only requests that name a model; the mismatch tell (L8) shows what ran.
2. Placed only on a trierarch whose reported default for that harness is allowed; with no reported default (Claude Code today) it waits with the reason "model disabled".
3. Refused for that fleet: the forms always fill in a model, and a request without one waits with the reason.

Pick 2: outcome 2 holds for every door, and it is the rule placement already follows for a value a machine does not offer (L5). Its cost: a Claude Code request without a model waits in a governed fleet until its requester names one; the forms already fill one in (L11).

**Q4. What counts as running** (outcome 5, L9).
1. Only placing is checked: an unassigned request, including one given back. An assigned request, a restart after a crash and a ship crewed again by its trierarch keep their model.
2. As 1, and an assigned request not yet final is taken back and waits with the reason.

Pick 1: the plugin decides only at placement today, and taking work back from a trierarch is a new path (0030 rejected moving a final assignment for the same reason). A disabled model then leaves the fleet as its ships are released or their requests change.

**Q5. Where it is set, and by whom** (L12).
1. A section on the Trierarchs page, beside what the machines offer, changed with `fleet:manage`.
2. The same, with a scope of the plugin's own namespace, declared as it declares `trierarch:join` (0055).

Pick 1: it is how every other plugin change is guarded, and the machines' reported models are the list the operator picks from. Its cost: requesting a crew also takes `fleet:manage` (0029), so whoever may request crews may also change the fleet's models. Option 2 if Thomas wants those two apart.
