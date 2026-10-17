# 0017 Squadrons are a separate package, a ship of the fleet

- `@aeolus-fleet/squadrons` forms squadrons of ships from blueprints and leads them. Optional: a fleet works with individual ships only.
- Its own process and its own database (it may share the fleet's Postgres server); its own Prisma schema and migrations. It never reads the fleet's tables, and the fleet never reads its.
- It reaches each fleet only through the public API, as that fleet's squadrons ship (one install serves many fleets, 0021), owned by argo (0045), with `fleet:read`, `fleet:commission`, `fleet:manage`, `labels:define`, `labels:assign` and `scopes:declare` (0046). Its reach: one read rule of argo's for the whole fleet, and manage over its squadrons' ships through a rule it declares on its own label (0037).
- The operator connects it in the console: the web app's server commissions that ship and hands its secret to squadrons server to server. Squadrons registers once, keeps only the crew token in its database, and crews the ship again with the token after a restart. There is no secret in its environment or files. Until connected it serves not connected, and a released squadrons ship leaves it not connected until the operator connects it again.
- It declares the namespace `squadrons`:
  - `squadrons:form`: a ship forms a squadron from a blueprint by message, content types `application/vnd.aeolus.squadron.*`, and stands it down;
  - `squadrons:scale`: the forming ship adds and removes members.
  It enforces both itself. A template names the scopes its ships get, granted within the subset rule; "no policy, the squadron blueprint decides". Limits per fleet, per forming ship and per squadron are its configuration, unset is none.
- It names the forming ship's owner on the squadron's ships at commission (`OwnerSet`, 0045), so they reach the forming ship by the same-owner rule. The flagship proxies to the forming ship, and to argo for a squadron argo formed. Once the forming ship is retired, it proxies to that ship's owner, argo as fallback.
- Its own pages run apart from the console (0043) and check argo with `console.session` (0012). For a person, it reads on behalf of the person's ship (`fleet:read`, 0034's read reach of that ship), so it serves a person only what that person may read and never holds the person's crew token.
- Aeolus knows nothing about squadrons beyond its ship and its declared namespace.

Why: the server stays as dumb as possible; squadrons is one client among others, with no back door. Forming through the flagship is "scalable, but through the flagship, that ship is the proxy towards the forming ship."

Rejected: squadrons inside the server; squadron tables in the fleet's database; a separate login for squadron pages; squadrons checking the asker's scopes carried with a message (no rights travel, 0046); squadrons-wide manage over the whole fleet.
