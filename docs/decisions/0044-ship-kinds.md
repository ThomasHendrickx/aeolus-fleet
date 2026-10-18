# 0044 Ship kinds: agent, person, app

- Kinds: `operator` (argo, 0012), `viewer` (0022), `agent` (a session), `person` (a human's ship, crewed by their own app or a chat), `app` (an application or an outside party, crewed by its adapter).
- Only an agent states a model (0018). A person or app ship states none.
- Only argo commissions a person ship. A ship with `fleet:commission` (0046) commissions agents, and app ships too when it also holds `fleet:on-behalf`, which argo grants: the gateway, which commissions a proxy ship once argo approves an outside party (interop I-5).
- A person's app holds the person's ship's lease, so the ship stays crewed while the person is away. A delivery to a person ship awaiting crew is not stuck (0042).

Why: "One network to connect all. And we need to be true on what it is." Apps and outside parties are ships, so the network gates them like any ship. Only argo commissioning person ships is about being true to what a ship is, not a guard (0016): an agent commissioning a "person" would be untrue. An app ship for an outside party is commissioned by the gateway, "since it knows about the outside parties", once argo approved the party, so argo still decides each one; the scopes argo grants it are the gate. More is "over engineering now".

Rejected: every such ship of kind `agent` with an optional model (the overview would have gaps); apps kept outside the fleet (Aeolus could not gate them); any `fleet:commission` holder commissioning any kind; anyone but argo commissioning a person ship; outside parties creating their own ships on first sign-in.
