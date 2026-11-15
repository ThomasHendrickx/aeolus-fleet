# A trierarch ship's kind

Purpose proposed for [#1607](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1607).

## Purpose

A person looking at their fleet finds the computers' trierarch ships among the agents, making it harder to see which ships do the work and which crew them. Giving a trierarch its own kind lets the person recognise it wherever a ship's kind appears and find the trierarchs together in Harbour, in the console and Bridge.

## Lessons to check against

- Kind describes lifecycle. Type is a free addressing handle. Scopes and reach govern rights. The blueprint and recorded kinds currently put the trierarch under `app`, while the issue reports ships stored as `agent`. Adding a kind needs Thomas's agreement to change that recorded language. [0044](../../decisions/0044-ship-kinds.md), [0050](../../decisions/0050-domain-language.md), [blueprint](../../blueprint.md#domain-language).
- A trierarch runs on a computer and crews assigned ships. The trierarch plugin commissions its ship. An agent states its session's model. These concrete parts need distinct meanings when the kind is added. [0026](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/decisions/0026-trierarch.md), [0030](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/decisions/0030-trierarch-plugin.md), [0018](../../decisions/0018-model-and-harness.md).
- Harbour is one shared part in `@aeolus-fleet/ui`, used by console and Bridge. The approved overview has State, Type, Labels and Search. A question about a new Kind control would reopen that choice. [Fleet overview](../fleet-overview/README.md#one-view-cards-or-list).
- Bridge lets a person see how their ships are doing without asking. A trierarch's identity must be understandable there too. [Bridge purpose](../bridge/README.md#1-purpose-agreed-cc1).
- Before 1.0, a direct change is allowed. Each release train takes up the contract through its minimum core version. [0013](../../decisions/0013-breaking-changes-before-1-0.md), [0049](../../decisions/0049-release-trains.md).

## Open questions

### 1. What is the kind called?

1. `trierarch`, shown as Trierarch or Trierarchs.
2. `computer`, shown as Computer or Computers.

**Pick 1.** Trierarch names the process crewing the ship. Computer already names the laptop or server it runs on.

### 2. Where should the kind appear?

1. A Trierarchs group in the shared Harbour in console and Bridge, with the same kind on ship details, discovery and existing API kind filters. The overview's Type filter offers the existing `trierarch` type.
2. Harbour first, with ship details, discovery and API kind filters following later.

**Pick 1.** A person should read the same kind wherever they encounter the ship. The shared Harbour carries the group to both apps.

### 3. How do existing trierarch ships move?

1. Move them in place at release, including those stored as `agent` or `app`, using the trierarch plugin's commissioning records and labels to identify them.
2. Retire each old ship and commission a replacement when its computer next joins.

**Pick 1.** A trierarch already has an inbox, a lease and assigned crew requests. Moving its kind in place preserves those relationships and gives existing computers the new kind at release. The builder must establish which ships the trierarch plugin commissioned before choosing the migration's exact selection.
