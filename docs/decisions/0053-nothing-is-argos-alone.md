# 0053 Nothing is argo's alone

- Every job argo does is a scope any actor can be granted (0057): a ship, an account through its groups, the installation. argo is the fail-safe (0057), not the holder of jobs no one else may do.
- The jobs that were argo's alone become scopes (each documented in the scope catalogue, 0046):

| Job | Was | Scope | Where |
| --- | --- | --- | --- |
| Commission a person ship | argo alone (0044) | `fleet:person` | the new ship, as below |
| Change an owner | argo alone (0045) | `fleet:owner` | manage reach of the ship |
| Explain reach, read refusals | argo alone (0034, 0046) | `fleet:explain` | read reach of the ships asked about |
| Connect a plugin | argo alone (0034) | `fleet:connect` | the fleet |
| Turn the viewer's read rule off | argo (0022) | `fleet:network` | the fleet's built-in rules |
| Assign values of a label it did not define | argo on any ship (0031) | `labels:any` | manage reach |
| Grant a plugin's scope | argo or the plugin (0046) | `scopes:grant`, holding it | manage reach of the ship |

- Granting stays as 0046 has it: an actor grants only scopes it holds, so nothing widens itself. A grant on a live ship, a change of owner and every `fleet:manage` call are checked against manage reach on the target ship. An account's own scopes come from its groups, never from a grant in the fleet.
- **A plugin's page** checks the actor's scopes, never whether it is argo: the networking plugin's rule editing, squadrons' writes and the gateway's approving each need a scope the plugin declares. A human on the page is their account, by the account token the page checks as core does (0058); argo and the viewer keep `console.session`. Every page action is also a call a ship holding the scope can make, so an agent does the same (0057).
- **A commission checks what the new ship would be.** The actor holds the scope for the kind (`fleet:commission` for an agent, with `fleet:on-behalf` for an app ship, `fleet:person` for a person ship); grants only scopes it holds; gives only label values of labels it defined, or values it carries itself (a ship's labels, an account's token); and names the owner 0045 allows: itself when it is a person ship, the account's person ship when it is an account (0057), its own owner otherwise, or with `fleet:on-behalf` the owner 0045 allows. So a new ship never reaches further than its commissioner can make it.

Why: "nothing argo does is argo-only; every job is a scope that can be granted." Thomas, on where an admin acts: "the action itself checks scope when needed; for commissioning, core does it, so the commission action checks what is allowed." Labels give reach, so a commission giving any label could give any reach.

Rejected: a list of argo's alone jobs; plugin pages admitting argo alone; a list of ships per admin beside reach; a commission checked against reach of a ship not made yet; a new ship taking labels its commissioner does not carry or define.
