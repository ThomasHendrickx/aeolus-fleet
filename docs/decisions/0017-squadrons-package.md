# 0017 Squadrons are a separate package, a ship of the fleet

- `@aeolus-fleet/squadrons` forms squadrons of ships from blueprints and leads them. Optional: a fleet works with individual ships only.
- Its own process and its own database (it may share the fleet's Postgres server); its own Prisma schema and migrations. It never reads the fleet's tables, and the fleet never reads its.
- It reaches the fleet only through the public API, as its management ship: an agent ship commissioned with `fleet:read` and `fleet:manage`. It registers with that ship's secret once, keeps the crew token in its database, and crews the ship again with the token after a restart. Trade-off accepted: it can manage the whole fleet, not only its squadrons (decision 0016).
- Aeolus knows nothing about squadrons. A pure API: the web app's server calls it with the console's session cookie, which squadrons checks with `console.session` (decision 0012); it needs no public address.

Why: The server stays as dumb as possible; squadrons is one client among others, with no back door.

Rejected: Squadrons inside the server; squadron tables in the fleet's database; a separate login for squadron pages.
