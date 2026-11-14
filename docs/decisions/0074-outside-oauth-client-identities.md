# 0074 Outside OAuth client identities

Every party has one OAuth client bound to its discovered issuer; every person's grant of the party uses that client. Automatic dynamic registration (RFC 7591) remains the default. The person adding the server may instead enter an existing client id, with a secret and its authentication method where required, or choose a gateway-controlled URL client id unique to that addition. Ask for an entered client dedicated to that server. URL ids support the service's plain URL convention or a gateway-owned client metadata document when the service advertises support. A failed or refused selected method never silently selects another. Public, `client_secret_post` and `client_secret_basic` clients are supported. Discovery from the protected resource, issuer binding, PKCE S256 or refusal, `resource` in authorization and token requests, state and issuer checks, and the existing outside-scope selection remain required.

If commission is definitely refused after automatic registration, best-effort delete only the client registered for that addition and report a failed delete. Retiring the party ends all its grants, revoking their tokens where offered and dropping them locally regardless of revocation success. Delete an outside client only when the gateway dynamically registered it for this party and holds its registration-management credentials. Never delete an entered client. A gateway URL document is withdrawn when its party is retired; there is no outside registration to delete.

Why: explicit client choices allow servers without dynamic registration while keeping each party's grants and consent isolated and preserving issuer and sign-in checks. Gateway ownership determines which clients it may delete.

Rejected: requiring pre-registered clients as the only method; silently falling back after registration refusal; one gateway URL client id shared across parties.

This supersedes the registration and client-deletion rules in [0067](0067-outside-oauth-sign-ins.md). The remaining per-person grant rules continue to apply. See [the design](../design/oauth-servers/client-identities.md).
