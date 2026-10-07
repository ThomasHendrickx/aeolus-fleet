# 0002 Ship secrets and scopes

- Secret: opaque `aeolus_sk_v1_<random>`, stored as SHA-256, max one valid per ship.
- Scopes on the server with the ship, set at creation, never carried by the ship and never changed after: `messages:send`, `messages:receive`, `fleet:read`, `fleet:manage`, `crew:assign`, `crew:run`, `labels:define`, `labels:assign`. Agents: send and receive, plus any of `fleet:read`, `fleet:manage`, `crew:assign`, `crew:run`, `labels:define` and `labels:assign` when commissioned with them (any caller with `fleet:manage` may give them, decision 0016). `argo`: all. Different scopes mean retiring the ship and commissioning a new one.
- `crew:assign` and `crew:run` act on crew requests only (0029): `crew:assign` writes assignments; `crew:run` reads the requests assigned to its own ship, and only for those ships gets the starting prompt (a new secret), releases and writes status. Neither commissions, renames, retires, lists, follows, pings, resends or dismisses.
- `labels:define` and `labels:assign` act on labels only (0031): define a label, change its values and delete it; assign and unassign the values of the labels the caller's ship owns.
- The secret serves only `register` (0015). The crew token lookup returns ship, fleet, kind and scopes in one query.

Why: Instant revocation (release ends the lease and its crew token); scopes cannot be forged by a ship.

Rejected: JWT as the ship credential (no instant revoke); `fleet:manage` for a trierarch (it would commission and retire, which crewing never needs); a scope crewing any ship of the fleet (0029). Short-lived JWTs for third parties stay possible later.
