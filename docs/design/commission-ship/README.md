# Commission a ship

## 1. Purpose

A person commissioning a ship faces 17 permission switches, a disabled Commission button without a clear reason, and no way on the ship page to add a permission later ([#1245](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1245)). They should be able to commission a ship that sends and receives without studying the scope catalogue, understand what still prevents commission, and change what the ship may do from its page, including letting it open a meeting.

## 2. Lessons to check against

- [Decisions index](../../decisions/README.md), especially 0016, 0034, 0046, 0050 and 0057: scopes say what, reach says where. Grant only what the actor may grant, within manage reach. Live grants and revokes already exist, take effect at the next call and record `ScopesChanged`. Bundled roles and scopes fixed at commission were rejected.
- [Gateway scopes](../gateway-scopes/gateway-scopes.md), lessons L4, L8 and section 4.1: descriptions explain scopes; pickers must include core, plugin and fleet scopes. A ship's type does not grant it scopes.
- [Scopes on behalf](../on-behalf-scopes/on-behalf-scopes.md): changing a live ship checks the granter, unlike a plugin commissioning on behalf of the asking ship. A console choice cannot widen that authority.
- [Ship owners](../ship-owners/README.md): argo must name a person ship at commission; with none, commission stays unavailable. Change owner sits beside the owner on the ship page. Explaining Commission must account for Owner as well as crew settings.
- [Console conventions](../console-conventions.md#crew-requests-and-trierarchs) start Request a crew on when the trierarch plugin is connected. Q2 asks to change that rule. [Conventions](../conventions.md#components-which-one) put persistent help inline, never only in a Tooltip or Toast.

## 3. Open questions

### Q1. How much must a person choose at commission?

1. Start with sending and receiving; offer extra actions when wanted, described in plain words, such as Read the fleet and Open a meeting.
2. Show every scope immediately, each with its description.

Pick: 1. An ordinary ship needs no extra grant. Keep each extra scope individually selectable, including plugin and fleet scopes, without making its type a permission choice.

### Q2. With no computer available, should Request a crew start on?

1. Keep today's default whenever the trierarch plugin is connected; the person turns it off to get the starting prompt.
2. Start it off when no computer offers a harness, so commission leads to the starting prompt; the person may still turn it on.

Pick: 2. A connected plugin alone cannot start a session. This changes the recorded default and needs Thomas's agreement.

### Q3. Where should the reason for a disabled Commission button appear?

1. Beside the button, naming what is missing and what to do, while keeping each field's own hint.
2. Only under the field that needs attention.

Pick: 1. The person pressing Commission should find the reason there, including when Owner or crew settings prevent it.

### Q4. Where should a person change a live ship's scopes?

1. On the ship page, beside the scopes it holds, offering grants and revokes within the actor's authority.
2. On a separate Scopes page, choosing a ship there.

Pick: 1. The person is already looking at the ship that needs Open a meeting. It follows Change owner and uses the existing live grant rule.
