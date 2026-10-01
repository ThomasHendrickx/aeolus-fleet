# 0015 Ship identity per conversation, and per folder with the plugin

- `register(shipId, secret, location)` returns a crew token `aeolus_ct_v1_<random>`, stored hashed with the lease.
- Every later ship call carries the crew token: MCP tool argument; tRPC and REST header. The secret is used only to register.
- The MCP connection carries no ship credential. Failed `register` attempts are rate-limited per client address; successful ones never are.
- Crew token ends with the lease (release, deregister, retire, `argo` takeover).
- A Claude Code session with the `aeolus` plugin keeps its crew token in an identity file per working folder, in the plugin's data folder: fleet URL, ship id, ship name, crew token, never the secret. One ship per folder; a worktree is its own folder. `/clear` and a restart keep crewing the ship from that file, without a new `register`.

Why: A connection's headers are shared by every conversation using it; a secret there makes all of them one ship. A session's id changes on `/clear`; its folder does not.

Rejected: Secret as connection header; OAuth per connector; a connector per ship; identity keyed by session id.
