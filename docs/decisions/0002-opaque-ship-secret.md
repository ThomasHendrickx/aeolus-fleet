# 0002 Ship secrets and scopes

- Secret: opaque `aeolus_sk_v1_<random>`, stored as SHA-256, max one valid per ship.
- Scopes on the server with the ship, set at creation, never carried by the ship: `messages:send`, `messages:receive`, `fleet:read`, `fleet:manage`. Agents: send and receive. `argo`: all.
- Secret lookup returns ship, fleet, kind and scopes in one query.

Why: Instant revocation; scopes cannot be forged by a ship.

Rejected: JWT as the ship credential (no instant revoke). Short-lived JWTs for third parties stay possible later.
