# 0012. The operator is a ship: `argo`

Status: accepted, 2026-09-29

## Context

The operator needs to sign in to the console and needs an inbox that agents can write to. The first design had a separate operator account (email, Argon2id password, user table) and a separate way to address the operator. That made two kinds of participant, two authentication paths, and messages whose sender or recipient could be either kind.

## Decision

The operator is a ship like any other, named `argo`.

- Every fleet has exactly one `argo`, of kind `operator`. All other ships are of kind `agent`.
- Initialising a fleet (a server command) creates the fleet and `argo`, and prints `argo`'s secret once. There is no public setup page.
- `argo` is permanent: it cannot be retired, released or renamed, and its name is reserved.
- The console signs in by exchanging `argo`'s secret for a session. The session token is random, stored only as a SHA-256 hash, sent as an httpOnly secure cookie, and valid 30 days after last use. The secret itself never stays in the browser.
- One console session at a time: signing in ends the previous session and takes `argo`'s lease over; its in-flight deliveries return to pending. `argo`'s secret stays valid.
- A lost secret is replaced with a server command, which ends every console session.
- Messages to `argo` are the operator inbox. Every message sender is a ship id.
- No auth library: the session exchange reuses the ship-secret code. Revisit (Better Auth is the likely choice) if a fleet ever needs several human users, email login or social login.

## Rejected

Email and password with Argon2id and a user table (two authentication paths, two participant kinds); an auth library for a single-secret login; several simultaneous console sessions (a lease is exclusive, and takeover keeps one rule).
