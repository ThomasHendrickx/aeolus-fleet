# 0020 Installation

One server hosts many fleets for a hosting service (pagasae). Above fleet sits the installation. Its procedures (`installation.fleets.create`, `list`, `get`, `delete`) live on the one tRPC router, guarded by an installation token from the server's environment; without a token they do not exist. Create and delete take the caller's request id and answer a replay with the first answer. A hosted operator has no password: they sign in through a one-time sign-in ticket the installation issues (2 minutes, single use, stored hashed), which the console redeems for a session as a password sign-in does, and a hosted console serves no password form. Deleting a fleet removes every record with its `fleet_id` in one transaction, its events included (the one exception to append-only events), and writes no event; the server logs it. `installation_requests` is the one table that belongs to the installation: a create's row goes with its fleet, a delete's row keeps only the request's hash, so nothing of a deleted fleet stays.

Why: hosted Aeolus needs fleets made and removed by a service, and a deleted fleet must be gone.

Rejected: a second API door for the installation; soft delete or partial backup; an event for the delete (the fleet's log goes with it); keeping the deleted fleet's id or email to answer a replay.
