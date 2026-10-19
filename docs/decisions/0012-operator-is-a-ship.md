# 0012 The operator is the ship `argo`

- One `argo` per fleet, kind `operator`; the other kinds are in 0044. Name reserved; never retired, released or renamed.
- `argo` is always crewed: the console is its crew, whether or not the operator is signed in, so it never shows Awaiting crew. Signing in still takes its lease over.
- `argo` has no secret. `register` with a secret is refused for `argo`. The only way to crew it is a console sign-in as argo: by an account an organisation admin allows for that fleet, with a sign-in ticket from pagasae (0054), or by argo's own sign-in.
- argo's own sign-in: email and password (Argon2id), with no organisation; not an account (0050). A server command creates fleet, `argo` and it; another resets the password and ends argo's console sign-in. No public setup page. A self-hoster who adds pagasae keeps it; a hosted fleet has none (0020).
- A console sign-in as argo names its account, or says it is argo's own sign-in, and every event argo's calls write carries it (0054).
- argo is the fail-safe (0057): a message that reaches argo is a failing of the system, visible through argo. It is where a failure becomes visible and the way out, never a normal path.
- Sign-in gives a session token: random, SHA-256 stored, httpOnly secure cookie, 30 days after last use. Cookie domain and allowed console origin are configured, so web and server may run on different hosts under one domain.
- One operator console session: sign-in ends the previous one and takes the lease over. Viewer sessions are apart (0022).
- A plugin's own pages (0043), or another service beside the console, check argo's or the viewer's console session with `console.session`, and a person's account token as core does (0058): its server forwards the browser's session cookie and gets the fleet, the expiry, the session's kind and its scopes, or `UNAUTHORIZED`. Only the cookie counts, never a crew token; no login of its own.
- Messages to `argo` are the operator inbox. Every sender is a ship.
- No auth library (Better Auth if several human users ever come).

Why: A secret for `argo` would let anything holding it become the operator; a human login cannot leak that way. argo exists because the fleet must always be able to act, so a permission bug never leaves a fleet unrecoverable without direct database access (Thomas). The server keeps the browser path direct (no proxy in the web app).

Rejected: `argo`'s secret pasted in the console; `argo`'s secret held by the web app (proxy for every call and WebSocket); auth library; parallel console sessions.
