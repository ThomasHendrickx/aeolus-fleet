# 0070 Retired ships

A retired ship leaves the fleet snapshot at once and, after the fleet's retention, leaves only a remnant its kept history names. D1 to D9 of [the retired ships design](../design/retired-ships/retired-ships.md) hold the detail.

- No count shows retired ships. The fleet list shows them only with Show retired, off by default.
- The hourly pruning pass (0066) removes a ship retired before its cutoff; a fleet with no retention keeps its retired ships for good. Each batch's `HistoryPruned` counts the ships it removed.
- A removed ship is a remnant: the ship row keeps its id, name, type, kind and its commission, retire and removed dates; its scopes, note, owner, commissioner, idempotency key and request hash are cleared, and its schedules go. Every row that names it keeps its foreign key and stays or goes by its own rule; no event is deleted for it.
- Nothing lists a remnant. It stays retired: its id is never claimed or addressed again.
- A commission repeated with the key of a removed ship commissions a new ship. Thomas: "name is unique for ships within those that are known, id is unique always."
- A link to a removed ship opens its remnant page with the history the fleet still keeps that names it.

Why: the snapshot shows the ships that sail (Thomas: "Both: hide now, remove after a retention period"); a remnant keeps every message, delivery and event naming the ship readable with no copied name, and the stuck snapshot's dates; one retention the fleet manager already sets and pays by.

Rejected: no way to list retired ships; nothing more than today's hiding; deleting the ship row with its name copied into every row naming it (a second source of truth); deleting the row once nothing names it (kept fleet changes name it for good); a separate retired-ship retention; a fixed period in core (0016); keeping the key on the remnant; a link to a removed ship opening nothing.
