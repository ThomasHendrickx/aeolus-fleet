# 0002 Ship secrets and scopes

- Secret: opaque `aeolus_sk_v1_<random>`, stored as SHA-256, max one valid per ship.
- Scopes on the server with the ship, set at creation, never carried by the ship and never changed after: `messages:send`, `messages:receive`, `fleet:read`, `fleet:manage`, `fleet:crew`. Agents: send and receive, plus `fleet:read`, `fleet:manage` and/or `fleet:crew` when commissioned with them (any caller with `fleet:manage` may give them, decision 0016). `argo`: all. Different scopes mean retiring the ship and commissioning a new one.
- `fleet:crew` allows, for any ship of the fleet, only: reading that one ship, getting its starting prompt (a new secret) and releasing it. Not commission, rename, retire, re-crew, list, follow, ping, resend or dismiss. It is the trierarch's scope (0026). Accepted and stated: a `fleet:crew` ship can take any ship's crew by release plus register.
- The secret serves only `register` (0015). The crew token lookup returns ship, fleet, kind and scopes in one query.

Why: Instant revocation (release ends the lease and its crew token); scopes cannot be forged by a ship.

Rejected: JWT as the ship credential (no instant revoke); `fleet:manage` for a trierarch (it would commission and retire, which crewing never needs). Short-lived JWTs for third parties stay possible later.
