# 0012 The operator is the ship `argo`

- One `argo` per fleet, kind `operator`; all other ships kind `agent`. Name reserved; never retired, released or renamed.
- `argo` has no secret. `register` with a secret is refused for `argo`. The only way to crew it is the operator's console login.
- Operator login: email and password (Argon2id), one account in v1. A server command creates fleet, `argo` and account; another resets the password and ends all sessions. No public setup page.
- Sign-in gives a session token: random, SHA-256 stored, httpOnly secure cookie, 30 days after last use. Cookie domain and allowed console origin are configured, so web and server may run on different hosts under one domain.
- One console session: sign-in ends the previous one and takes the lease over.
- Messages to `argo` are the operator inbox. Every sender is a ship.
- No auth library (Better Auth if several human users ever come).

Why: A secret for `argo` would let anything holding it become the operator; a human login cannot leak that way. The server keeps the browser path direct (no proxy in the web app).

Rejected: `argo`'s secret pasted in the console; `argo`'s secret held by the web app (proxy for every call and WebSocket); auth library; parallel console sessions.
