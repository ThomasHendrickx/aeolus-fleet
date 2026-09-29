# 0012 The operator is the ship `argo`

- One `argo` per fleet, kind `operator`; all other ships kind `agent`. Name reserved; never retired, released or renamed.
- A server command creates fleet and `argo`, prints the secret once. No public setup page.
- Console exchanges the secret for a session token: random, SHA-256 stored, httpOnly secure cookie, 30 days after last use.
- One console session: sign-in ends the previous one and takes the lease over; secret stays valid.
- Lost secret: server command replaces it and ends all sessions.
- Messages to `argo` are the operator inbox. Every sender is a ship.
- No auth library (Better Auth if several human users ever come).

Why: One participant kind, one auth path.

Rejected: Email, password and user table; auth library; parallel console sessions.
