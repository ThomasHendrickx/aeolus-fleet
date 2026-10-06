# 0029 Crew request: declared crew state on the ship

- A crew request says "keep this ship crewed, with these settings". On the ship, at most one per ship, standing (level, not edge).
- Its settings (0027) are stored without meaning; the server checks their size only, against a constant in `common`.
- Three parts, three writers, each owning its part:
  - the request (settings), by a requester with `fleet:manage`;
  - the assignment (which trierarch ship), by a ship with `crew:assign`, only if still unassigned (optimistic claim);
  - the status (crewing, running, restarting, crashed, releasing), by the assigned trierarch with `crew:run`.
- Two scopes replace `fleet:crew`:
  - `crew:assign` writes assignments;
  - `crew:run` reads the requests assigned to its ship, and only for those ships gets the starting prompt, releases and writes status.
- Removing the request marks it releasing; the assigned trierarch stops the session, ends the lease, cleans its workspace and confirms; only then does the request disappear (a finalizer).
- Unassigned, the request is the operator's to-do ("needs crew", get starting prompt). Crewing it by hand fulfils it; a ship already crewed is never assigned.
- Events: requested, assigned, status changed, removed.
- A trierarch's ships are a query (requests assigned to it), not a list on its ship.

Why: assigning crews was the operator's manual work, never state the server held. Declared state in the fleet lets any requester ask for a crew without knowing who provides it, and lets a plugin take the manual work away.

Rejected: crew state in a plugin's own database (requesters would have to know the plugin); `fleet:crew` for any ship (a trierarch could take any ship's crew); a one-off "crew it once" command (edge, not level).
