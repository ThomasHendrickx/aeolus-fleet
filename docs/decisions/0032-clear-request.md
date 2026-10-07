# 0032 Clearing a kept worktree is a declared request

- A trierarch keeps a worktree with changes when it releases its ship (0026). A human clears it by asking its trierarch, never by reaching into the machine: `fleet.clearWorktree` (`fleet:manage`) stores a clear request for the trierarch ship, naming the worktree as the trierarch's report does, by the ship it belonged to and its repository. Paths stay on the machine: the trierarch maps the name to its path.
- One request per trierarch, ship and repository. Asking again for one it holds changes nothing. A request names a ship of type `trierarch` that is not retired, and a ship of the fleet; anything else is refused.
- At most 100 pending per trierarch (`CLEAR_REQUESTS_PER_TRIERARCH_MAX` in common), named by the refusal.
- A pending request has no status beyond pending and is never withdrawn.
- `fleet.clearRequests` reads the pending requests: every trierarch's with `fleet:read` (the console shows the worktree clearing), the caller's own with `crew:run`.
- The trierarch removes the worktree only when it kept it, under its own worktree root, then confirms with `fleet.confirmWorktreeCleared` (`crew:run`, its own requests only): `removed`, or `not-kept` when it keeps no such worktree. The request then goes.
- Retiring the trierarch removes its pending requests.
- Events on the trierarch's ship, each in the same transaction as its change: WorktreeClearRequested, WorktreeCleared (with the outcome), WorktreeClearRemoved. Details hold the worktree's ship id and repository.

Why: the machine is the trierarch's; the fleet only declares what should happen, as with a crew request (0029). A request survives a trierarch that is down, and its confirmation proves the work was done. Names, not paths, keep the machine's layout off the server.

Rejected: a path in the request (paths stay on the machine); withdrawing a pending request (a clear is cheap and the trierarch may already be at it); statuses beyond pending (the trierarch confirms or the request waits); the console deleting files through another channel (one door, one owner of the machine).
