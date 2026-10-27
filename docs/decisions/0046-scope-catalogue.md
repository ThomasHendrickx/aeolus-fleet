# 0046 Scopes: the catalogue, declaring and granting

- A scope is `<namespace>:<action>`: lowercase `a-z`, `0-9`, `-`, starting with a letter, 1 to 32 characters each. Scopes say what a ship may do; reach says where (0034). No rights travel with a message: a receiving ship is never a policy point, and core and the plugins enforce scopes and reach.
- Core namespaces, reserved and enforced by core only: `messages`, `fleet`, `crew`, `labels`, `scopes`, `meetings`. A namespace holds core's scopes, one plugin's, or the fleet's own, never two of them.

| Scope | Allows | Where |
| --- | --- | --- |
| `messages:send` | send, answer, ask, discover (0047) | send reach |
| `messages:receive` | receive and confirm, the computer side's calls (0040), argo's read and done | its own ship |
| `messages:force` | a forced send (0040) | send reach |
| `messages:resend` | resend or dismiss a stuck delivery | read reach of the message; the resend is checked as its original sender |
| `fleet:read` | read ships, timelines, messages, labels, events and fleet-wide views | read reach |
| `fleet:person` | commission a person ship for an account (0052) | the new ship, as 0053 |
| `fleet:owner` | change an owner (0045) | manage reach |
| `fleet:explain` | explain reach, read refusals (0034) | read reach of the ships asked about |
| `fleet:connect` | connect a plugin (0034) | the fleet |
| `labels:any` | assign values of any label (0031) | manage reach |
| `fleet:verify` | write and withdraw its verified facts about a ship (0059) | manage reach |
| `fleet:commission` | commission an agent, and with `fleet:on-behalf` an app ship (0044), granting only what it may grant | the new ship's owner (0045) |
| `fleet:manage` | rename, release, recrew, retire, starting prompt, ping, crew request, clear a worktree | manage reach |
| `crew:assign`, `crew:run` | as 0029 | any request; assignment |
| `labels:define` | its labels and rules on them (0037) | labels it owns |
| `labels:assign` | values of labels it owns | its own ship and ships it commissioned |
| `fleet:network` | drafting and applying the fleet's own rules, reading the rules and turning the viewer read (0034, 0035) | the fleet's rules |
| `fleet:on-behalf` | a plugin's calls for another ship: read on behalf of a named ship (0034), name the asking ship's owner at commission, the owner its approver picked for an app ship it commissions, or the asking account's person ship as owner (0045, 0055) | the named ship's read reach |
| `scopes:declare` | take up one plugin namespace and declare its scopes | its own namespace |
| `scopes:grant` | grant and revoke on a live ship | what it may grant |
| `scopes:define` | define, describe and remove the fleet's own scopes | the fleet |

- Scopes are held by a ship, or carried in an account's token from its groups and its own rights (0052, 0058), and checked the same way for every actor (0057).
- Granting: at commission, scopes the commissioner holds and scopes of its own namespace. A commissioner holding `fleet:on-behalf` that names the asking ship (`ownerOf`, 0045) grants instead the scopes the asking ship holds (argo's every scope), plus its own namespace's; `ShipCommissioned` names that ship as `scopesFrom`; a retired asking ship is refused (design on-behalf-scopes). Core trusts the plugin to name the ship that asked. On a live ship, `scopes:grant` within the same rule and the ship's manage reach, effective at the next call, with `ScopesChanged`. argo holds and grants everything. Every agent, person and app ship gets `messages:send` and `messages:receive`.
- A plugin declares one namespace for good with `fleet.declareScopes` (its whole list, at most 20, one-line descriptions), `ScopesDeclared`. Core stores and answers its scopes and never checks them; the plugin enforces them. Retiring the declarer frees the namespace and removes its scopes from every ship.
- The fleet's own scopes, in the company's words such as `crm:read-leads`: any actor holding `scopes:define` defines one with a one-line description (`fleet.defineScope`, `ScopeDefined`), changes its description (`fleet.describeScope`, `ScopeDescribed`; never renamed) and removes it (`fleet.removeScope`, `ScopeRemoved`). They are the fleet's, never retired with whoever defined them, with no cap. Granted as any scope: only by an actor that holds it, so defining one widens no one's access. Whoever needs them enforces them, such as the gateway on a tool call. The namespaces of the plugins Aeolus knows (`gateway`, `squadrons`, `trierarch`) are reserved; removing the fleet's last scope of a namespace frees it.
- `fleet.scopes` lists every namespace, saying whose it is: core's, a plugin's with its declaring ship, or the fleet's.
- Refused, each by name: a malformed scope, a core namespace declared or defined, a reserved namespace defined, a namespace taken by a plugin or the fleet (CONFLICT), a second namespace, more than 20 in a plugin's namespace, a scope the fleet has defined again (CONFLICT), removing a scope active ships hold (CONFLICT, naming how many), granting a scope neither declared nor defined, granting a core or fleet scope the granter lacks, granting a plugin scope the granter does not hold, unless it is its declarer.
- Not scopes: argo's, the viewer's and the installation's built-in reach (0034). Nothing is argo's alone (0053).

Why: the operator grants only what a ship needs, and plugins police their own scopes without core knowing them. The fleet names in its own words what its ships may do at outside parties (design gateway-scopes); a cap fits a plugin's list, not the fleet's words. A ship grants only what it holds, so nothing widens itself; on behalf, the asking ship only passes on what it holds, as Kubernetes impersonation acts with the impersonated user's permissions and names both. Scope changes on a live ship take effect at once and leave an event.

Rejected: core proving the asking ship by a message id (a console form and an add-member are no messages to the plugin); a retired asking ship granting as it stood; on-behalf grants on a live ship; resource-scoped scopes and roles that bundle scopes (models B and C of the design); scopes fixed at commission (a ship retired to change one); a plugin taking several namespaces; a request carrying its asker's scopes (policy, and a receiving ship as a policy point); the fleet's scopes owned and retired with whoever defined them, as labels are; a namespace shared by the fleet and a plugin.
