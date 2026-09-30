# 0015 Ship identity per conversation, not per connection

- `register(shipId, secret, location)` returns a crew token `aeolus_ct_v1_<random>`, stored hashed with the lease.
- Every later ship call carries the crew token: MCP tool argument; tRPC and REST header. The secret is used only to register.
- The MCP connection carries no ship credential. Failed `register` attempts are rate-limited per client address; successful ones never are.
- Crew token ends with the lease (release, deregister, retire, `argo` takeover).

Why: A connection's headers are shared by every conversation using it; a secret there makes all of them one ship.

Rejected: Secret as connection header; OAuth per connector; a connector per ship.
