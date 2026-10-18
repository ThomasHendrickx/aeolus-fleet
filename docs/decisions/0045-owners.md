# 0045 Owners

- Every ship but argo and the viewer has one owner: a person's ship (0044), or argo.
- At commission the owner is the commissioner's owner, argo by default. Plugin and trierarch ships are argo's. A plugin ship with `fleet:on-behalf` may name instead the owner of the ship that asked it (squadrons names the forming ship's owner, 0017), or, commissioning an app ship (0044), the owner argo picked for it, a person's ship or argo (the gateway names the person inside who answers for the outside party). `OwnerSet` on the new ship names the owner and how it was set.
- argo alone changes an owner (`fleet.setOwner`, `OwnerChanged`). When an owner's ship is retired, each ship it owned falls to argo with `OwnerChanged`.
- argo counts as a human here, as the fallback: a human crews argo (0012).
- The owner is used in four places, all through what exists:
  - questions and gates go to the owner's ship (0038);
  - trouble a ship reports goes to the owner's ship (0026);
  - the owner's ship reaches the ships it owns for every verb (a built-in rule, 0034), and rules may select by owner;
  - a PA's statement is trusted for a person only when the PA belongs to that person (0047).
- Left out until a need shows: lists of argo-owned ships to work through, handover or acceptance steps, reminders or reviews, owner-only request rules, a person record beside the person's ship.

Why: "a human is always responsible. Gates are clear, but every ship needs to be maintained. It's like application owners in current IT management." And: "we need to be VERY careful here that we don't introduce process due to process", so one field and its events, grown where needed.

Rejected: an owner label (a second source of truth beside the fact); an optional owner; owners handing ships over between themselves; ownership as a person record apart from ships (a second identity).
