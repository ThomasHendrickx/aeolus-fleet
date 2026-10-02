# 0002 Ship secrets and scopes

- Secret: opaque `aeolus_sk_v1_<random>`, stored as SHA-256, max one valid per ship.
- Scopes on the server with the ship, set at creation, never carried by the ship and never changed after: `messages:send`, `messages:receive`, `fleet:read`, `fleet:manage`. Agents: send and receive, plus `fleet:read` and/or `fleet:manage` when commissioned with them (any caller with `fleet:manage` may give them, decision 0016). `argo`: all. Different scopes mean retiring the ship and commissioning a new one.
- The secret serves only `register` (0015). The crew token lookup returns ship, fleet, kind and scopes in one query.

Why: Instant revocation (release ends the lease and its crew token); scopes cannot be forged by a ship.

Rejected: JWT as the ship credential (no instant revoke). Short-lived JWTs for third parties stay possible later.
