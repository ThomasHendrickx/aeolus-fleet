# 0002 Ship secrets and scopes on the server

- Secret: opaque `aeolus_sk_v1_<random>`, stored as SHA-256, max one valid per ship.
- Scopes on the server with the ship, never carried by the ship: the catalogue, granting and plugin namespaces are 0046.
- The secret serves only `register` (0015). The crew token lookup returns ship, fleet, kind, owner and scopes in one query.

Why: Instant revocation (release ends the lease and its crew token); scopes cannot be forged by a ship.

Rejected: JWT as the ship credential (no instant revoke); a scope crewing any ship of the fleet (0029). Short-lived JWTs for third parties stay possible later.
