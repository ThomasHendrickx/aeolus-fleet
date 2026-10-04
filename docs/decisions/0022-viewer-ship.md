# 0022 Viewer ship

- A fleet the installation creates with `viewer: true` gets one ship named `viewer`, kind `viewer`, type `viewer`, scope `fleet:read` only. Only `installation.fleets.create` makes it; the name is reserved. It shows in the fleet like any ship.
- Permanent, as `argo`: never released, retired or renamed. Always crewed, never pinged, never in Needs attention. It has no secret and receives nothing: a send to it, or to its type, is refused.
- The installation issues a viewer ticket (`issueSignInTicket` with `as: 'viewer'`; refused for a fleet without the viewer ship). Redeemed, it starts a viewer session: many at once, holding no lease, beside the operator's session, which never ends them. Each is valid 2 hours after its last use and 24 hours after it started at most; it ends by expiry, by its own sign-out, or with its fleet. Writes `ViewerSessionStarted`.
- `console.session` answers `{ fleetId, expiresAt, kind, scopes }`, so a service beside the console serves a viewer reads only: squadrons serves what needs `fleet:manage` to the operator alone. `console.account` answers a viewer `{ kind, session }`, no email or theme; `setTheme` refuses it.

Why: a read-only look at a live fleet (the hosted demo is its first user) without handing out the operator's session or a crew line. A ship of its own keeps the rule that every caller is a ship and is authorised by its scopes.

Rejected: a read-only flag on `argo`'s session (one caller with two rights); viewer sessions holding a lease (they would take each other over); the demo runner in this repo (it lives with the hosting service).
