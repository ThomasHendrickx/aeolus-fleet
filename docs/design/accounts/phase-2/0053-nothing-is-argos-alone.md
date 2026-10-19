# 0053 Nothing is argo's alone (draft)

- Every job argo does is a scope that can be granted. argo holds every scope and reaches every ship by a built-in rule that is never off (0034), so the fleet can always act: a permission bug never leaves a fleet unrecoverable without direct access to the database. That is why argo exists, not to hold jobs no one else may do.
- The jobs that were argo's alone become scopes (names P5, Thomas's to set):

| Job | Was | Scope | Where |
| --- | --- | --- | --- |
| Commission a person ship | argo alone (0044) | `fleet:person` | the new ship, as below |
| Change an owner | argo alone (0045) | `fleet:owner` | manage reach of the ship |
| Explain reach, read refusals | argo alone (0034, 0046) | `fleet:explain` | read reach of the ships asked about |
| Connect a plugin | argo alone (0034) | `fleet:connect` | the fleet |
| Turn the viewer's read rule off | argo (0022) | `fleet:network` | the fleet's built-in rules |
| Assign values of a label it did not define | argo on any ship (0031) | `labels:any` | manage reach |
| Grant a plugin's scope | argo or the plugin (0046) | `scopes:grant`, holding it | manage reach of the ship |

- Granting stays as 0046 has it: a ship grants only scopes it holds, so nothing widens itself. `scopes:grant` on a live ship is checked against manage reach on that ship, as every other change to a ship is.
- A plugin's page checks the signed-in ship's scopes, never whether it is argo: the networking plugin's rule editing, squadrons' writes and the gateway's approving each need a scope that plugin declares, which a person ship may hold. A page knows the signed-in ship from `console.session` for argo or the viewer, or from a sign-in through pagasae for a person (0054).
- A human doing admin work in a fleet acts as their own person ship, with the scopes their groups give (0052). Where it acts is its manage reach (0034): every `fleet:manage` call, every grant and every owner change is checked against manage rules on the target ship.
- A commission checks what the new ship would be (P4). The commissioner holds the scope for the kind (`fleet:commission` for an agent, with `fleet:on-behalf` for an app ship, `fleet:person` for a person ship); grants only scopes it holds; gives only label values of labels it defined, or values its own ship carries; and names as owner itself when it is a person ship, its own owner otherwise, or, with `fleet:on-behalf`, the owner 0045 allows. So a new ship never reaches further than its commissioner can make it reach, and a commission needs no reach of a ship that does not exist yet.
- A person ship that commissions a ship owns it (0045 had the commissioner's owner, so argo): the human who made it answers for it, and reaches it through the owner rule.
- argo keeps what makes it the way back: permanent, every scope, its built-in reach, a way in that depends on nothing (0054).

Why: "nothing argo does is argo-only; every job is a scope that can be granted. argo exists because the fleet only understands ships, holds everything, and must always be able to act, so a permission bug never leaves a fleet unrecoverable without direct database access." Thomas, on where an admin acts: "the action itself checks scope when needed; for commissioning, core does it, so the commission action checks what is allowed." Labels give reach, so a commission that could give any label could give any reach; limiting it to labels the commissioner defines or carries keeps reach from widening.

Rejected: keeping a list of argo's alone jobs; plugin pages admitting argo alone; a separate list of ships per admin beside reach; checking a commission against reach of a ship not yet made; a new ship taking labels its commissioner does not carry or define.

Changes: 0012 (its why), 0022, 0031, 0034, 0043, 0044, 0045, 0046, interop I-5.
