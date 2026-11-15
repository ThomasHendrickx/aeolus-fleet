# A trierarch ship's kind

Purpose and decisions approved for [#1607](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1607). Screen mockups await Thomas's approval in [PR #1889](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1889).

## Purpose

A person looking at their fleet finds the computers' trierarch ships among the agents, making it harder to see which ships do the work and which crew them. Giving a trierarch its own kind lets the person recognise it wherever a ship's kind appears and find the trierarchs together in Harbour, in the console and Bridge.

## Decisions

- The kind is `trierarch`, displayed as Trierarch or Trierarchs. Type remains the free addressing handle; scopes and reach govern rights ([0044](../../decisions/0044-ship-kinds.md)).
- Show the kind everywhere at the same release: a Trierarchs group between Agents and Plugins in the shared Harbour in console and Bridge, a Trierarch kind badge on ship details, discovery, and existing API kind filters. Keep the overview's State, Type, Labels and Search controls; Type already offers `trierarch`. The trierarch plugin stays in Plugins.
- Change existing trierarch ships' kind in place at release, preserving their ids, inboxes, leases and crew requests. Identify them through the trierarch plugin's commissioning records and labels, including any stored as `agent` or `app`; type alone is not proof. The implementation must establish the exact selection before the migration.

## Code evidence

The [plugin's join-machine](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/90cd8423267c257b71ac6bcfc058a0a4fa6ee25a/packages/trierarch-plugin/src/core/machines/join-machine.ts) commissions type `trierarch` with `crew:run` and omits kind. Core's [commission-ship](../../../packages/core/src/domain/registry/commission-ship.ts) uses `input.kind ?? 'agent'`. Thus the current commissioning path produces an agent, despite the blueprint's description of a trierarch as an app ship. The new kind replaces that description for computer trierarchs; the plugin ship remains distinct.

## Concrete parts

Core/common: ship kind schemas, commissioning, discovery and kind filters, and the migration. Trierarch plugin: commission with kind `trierarch`. Shared UI: Harbour grouping and its kind label/icon. Console and Bridge: consume that group; ship details show kind separately from type. Update the blueprint and recorded kind/model rules when implementing; only agents state a model ([0018](../../decisions/0018-model-and-harness.md)). No new read or overview control is needed. Existing Harbour and list read budgets still apply at 3,000 ships and 10 million messages per fleet.

## Screens

Before/after pairs show the same `mac-studio` ship moving from Agents to Trierarchs and gaining a kind badge beside its existing type on details. Light and dark images are linked from the PR at their image commit; they are design mockups, not running application screenshots. Harbour uses the existing console shell and shared part; Bridge receives the same group in its Harbour column.

| Screen | Before | After |
| --- | --- | --- |
| Harbour, light | [Before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/harbour-before-light.png) | [After](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/harbour-after-light.png) |
| Harbour, dark | [Before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/harbour-before-dark.png) | [After](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/harbour-after-dark.png) |
| Details, light | [Before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/details-before-light.png) | [After](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/details-after-light.png) |
| Details, dark | [Before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/details-before-dark.png) | [After](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0c90c18bcff5ff59d81484e8767eb51c741873d0/docs/design/trierarch-kind/mockups/details-after-dark.png) |
