# 0042 Stuck deliveries

A delivery is stuck when it waits on something only a ship, a crew or the operator can change (#304). The fleet reads its stuck deliveries, how long they wait and how that went over 7 days, as facts with no thresholds (0016), for the console's Health and the installation's fleets.

- **Causes,** one per delivery, the first that holds:
  1. **Undeliverable:** not dismissed. Its place is the ship it was last handed to, else its type.
  2. **No ship can take:** pending to a type with no active ship that may claim it (0041, 0034). Its place is the type.
  3. **Waiting for crew:** pending to a ship awaiting crew, or to a type whose every active ship that may claim it awaits crew. Its place is the ship, or the type.
  4. **Stalled in flight:** overdue, its pushed clock ran out (0040), whether or not argo was told of it yet; or handed on a plain lease whose session was last seen no later than the hand-over, 10 minutes or more ago (the pushed lease's not confirmed clock). Its place is the ship.
- **Since:** how long it waits counts from its state: undeliverable from when it became so, pending from its latest return else its send, in flight as the overdue clocks count it.
- **Reads:** stuck now, by cause and place, each with its count and oldest since; stuck per hour over the last 7 days; deliveries acknowledged in the last 24 hours, with the median from send to acknowledgement; and, for each place that is a ship, the machine whose trierarch its crew request is assigned to.
- **The trend** is replayed at read time from the fleet's events, by the same rule at each hour: states, leases, pushes and turns from their events; a plain lease's last seen is one column, so a plain stall counts from 10 minutes after the hand-over until it left handed, when that last seen is still no later than the hand-over.
- **Read, not stored:** no table or event, as 0041.
- **Not handled** is execution, not delivery (0001): it is no cause, and the health reads leave it out.

Why: health must show what is stalled, where, since when and whether it gets better or worse, and the operator needs ages and a trend for that. The rule reuses the 10 minute clock rather than a threshold of its own.

Rejected: the ages kept out of the console (0041's former rule); a plain stall by its own clock or a heartbeat (0010); counting only the overdue deliveries argo was told of (one per lease); a health table or events kept by the server.
