# 0059 Verified facts

- A verified fact is a fact an actor checked about a ship, stored as its writer wrote it, naming the writer. Like a statement (0047) it is a claim: core checks its shape, compares it with nothing and acts on none of it.
- Any actor holding `fleet:verify` writes its facts about a ship within its manage reach (0034, 0053), not a retired one. The gateway's ship gets the scope when argo connects the gateway.
- One fixed shape, in common: `checked`, from a closed list (`clientIdDocumentDomain`, `tlsHost`, `a2aCardDomain`, `oauthSubject`), `value` (a domain, a host or a subject, at most 255 characters), and `issuer` for `oauthSubject` only (at most 2048). Never a URL path or a credential: NAT hides addresses and secrets, not who the party is.
- `fleet.setVerifiedFacts` sets the writer's facts about one ship whole, at most 10, each once; none withdraws them. Another writer's facts stay. The same facts again change nothing; a change writes `VerifiedFactsSet` with how many facts, never their values, and every fact of the set takes the time of the call.
- They live with the ship, not the lease: until their writer replaces or withdraws them, the writer retires, or the ship retires.
- Read as the statement is read: discovery shows them as `verified` beside `statement`, each with `by` (a ship by id and name, an account by id, the installation) and `at`, to the ships that can send to the ship, and argo.
- Person ships are out: who a person ship belongs to is the link to their account, still to build.

Why: a ship found through discovery learns only what it says about itself, and a reader cannot tell a claim from what was checked (interop 4.4 (a)). A scope any actor may hold keeps it from being the gateway's alone (0053, A9); a core scope because core stores and guards the record (0046). Every reader needs one shape (0047). A fact is about the party behind the ship, so a ship crewed again stays verified.

Rejected: only the gateway, only about proxy ships; core marking a fact that disagrees with the statement (policy, 0016, and vouching for content, interop 4.4 (c)); a scope the gateway declares (core would enforce a plugin's scope); only the commissioner writing; opaque JSON from the writer; a fixed field per gateway check; facts going with the lease; reading them only with `fleet:read`; "verified by the gateway" without what was checked; a person ship's email or IdP subject as a fact (no personal data in core, 0058).
