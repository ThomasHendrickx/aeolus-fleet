# 0029 Crew request: declared crew state on the ship

- A crew request says "keep this ship crewed, with these settings". On the ship, at most one per ship, standing (level, not edge).
- Its settings (0027) are stored without meaning; the server checks their size only, against a constant in `common`.
- Settings size: at most 16 KB (`CREW_REQUEST_SETTINGS_MAX_BYTES` in common), counted as the UTF-8 bytes of the serialized JSON. A larger request is refused with its size, the limit and this decision ("settings is 18211 bytes, the limit is 16384 (decision 0029)"). Why 16 KB: settings say how to crew a ship, not what it works on; a first prompt is at most 8 KB (0027) and content goes elsewhere by reference, as with report details (0028). When it bites, the request carries content: fix the requester, not the limit. Changing it means revising this decision.
- Every request replaces the settings whole and moves their version by one (1 for the first), so the assigned trierarch notices a change. Never argo, the viewer ship or a retired ship; retiring a ship removes its request.
- Three parts, three writers, each owning its part:
  - the request (settings), by a requester with `fleet:manage`;
  - the assignment (which trierarch ship), by a ship with `crew:assign`, only if still unassigned (optimistic claim);
  - the status (crewing, running, restarting, crashed, releasing), with the restart attempt (0 on the first start) and when the session started, by the assigned trierarch with `crew:run`.
- Two scopes, not one that crews any ship:
  - `crew:assign` writes assignments;
  - `crew:run` reads the requests assigned to its ship, and only for those ships gets the starting prompt, releases and writes status.
- Assignment goes to any active ship of the fleet: the fleet does no routing, and a ship that is no trierarch just gets work it does not understand. Only an unassigned request of a ship that awaits crew is assigned.
- Removing an unassigned request deletes it. Removing an assigned one marks it releasing; the assigned trierarch stops the session, ends the lease, cleans its workspace and confirms; only then does the request disappear (a finalizer). Releasing is irreversible: the trierarch may write only releasing, a new request for the ship is refused until the release completes, and a second remove is an OK with no event.
- Unassigned, the request is the operator's to-do ("needs crew", get starting prompt). Crewing it by hand fulfils it; a ship already crewed is never assigned.
- While unassigned, the assigner (`crew:assign`) may write a reason why no trierarch can take it: one line of at most 200 characters, cleared on assignment, shown in the operator's needs-crew to-do.
- Who crewed the ship is derived, never stored: the ship that got the starting prompt its open lease claimed with (argo for a hand crew, or its trierarch).
- Events: requested, explained (the reason), assigned, status changed, removed.
- A trierarch's ships are a query (requests assigned to it), not a list on its ship.

Why: assigning crews was the operator's manual work, never state the server held. Declared state in the fleet lets any requester ask for a crew without knowing who provides it, and lets a plugin take the manual work away.

Rejected: crew state in a plugin's own database (requesters would have to know the plugin); one scope crewing any ship (a trierarch could take any ship's crew); a one-off "crew it once" command (edge, not level).
