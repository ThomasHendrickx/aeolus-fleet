# 0046 Scopes: the catalogue, declaring and granting

- A scope is `<namespace>:<action>`: lowercase `a-z`, `0-9`, `-`, starting with a letter, 1 to 32 characters each. Scopes say what a ship may do; reach says where (0034). No rights travel with a message: a receiving ship is never a policy point, and core and the plugins enforce scopes and reach.
- Core namespaces, reserved and enforced by core only: `messages`, `fleet`, `crew`, `labels`, `scopes`.

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
| `fleet:commission` | commission an agent, and with `fleet:on-behalf` an app ship (0044), granting only what it may grant | the new ship's owner (0045) |
| `fleet:manage` | rename, release, recrew, retire, starting prompt, ping, crew request, clear a worktree | manage reach |
| `crew:assign`, `crew:run` | as 0029 | any request; assignment |
| `labels:define` | its labels and rules on them (0037) | labels it owns |
| `labels:assign` | values of labels it owns | its own ship and ships it commissioned |
| `fleet:network` | drafting and applying the fleet's own rules, reading the rules and turning the viewer read (0034, 0035) | the fleet's rules |
| `fleet:on-behalf` | a plugin's calls for another ship: read on behalf of a named ship (0034), name the asking ship's owner at commission, the owner its approver picked for an app ship it commissions, or the asking account's person ship as owner (0045, 0055) | the named ship's read reach |
| `scopes:declare` | take up one plugin namespace and declare its scopes | its own namespace |
| `scopes:grant` | grant and revoke on a live ship | what it may grant |

- Scopes are held by a ship, or carried in an account's token from its groups and its own rights (0052, 0058), and checked the same way for every actor (0057).
- Granting: at commission, scopes the commissioner holds and scopes of its own namespace. On a live ship, `scopes:grant` within the same rule and the ship's manage reach, effective at the next call, with `ScopesChanged`. argo holds and grants everything. Every agent, person and app ship gets `messages:send` and `messages:receive`.
- A plugin declares one namespace for good with `fleet.declareScopes` (its whole list, at most 20, one-line descriptions), `ScopesDeclared`. Core stores and answers its scopes and never checks them; the plugin enforces them. Retiring the declarer frees the namespace and removes its scopes from every ship. `fleet.scopes` lists every namespace.
- Refused, each by name: a malformed scope, a core namespace declared, a namespace taken (CONFLICT), a second namespace, more than 20, removing a scope ships hold, granting an undeclared scope, granting a core scope the granter lacks, granting a plugin scope the granter does not hold, unless it is its declarer.
- Not scopes: argo's, the viewer's and the installation's built-in reach (0034). Nothing is argo's alone (0053).

Why: the operator grants only what a ship needs, and plugins police their own scopes without core knowing them. A ship grants only what it holds, so nothing widens itself. Scope changes on a live ship take effect at once and leave an event.

Rejected: resource-scoped scopes and roles that bundle scopes (models B and C of the design); scopes fixed at commission (a ship retired to change one); a plugin taking several namespaces; a request carrying its asker's scopes (policy, and a receiving ship as a policy point).
