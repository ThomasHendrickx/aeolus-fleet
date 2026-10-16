# 0041 Fleet health

The installation describes each fleet's health beside its measures (#304): five figures read from the fleet's delivery states and times, never its payloads, so a hosting service sees across fleets whether messages reach their ships.

- **Figures:** oldest pending (when its oldest pending delivery was sent), oldest in flight (since when its oldest received or handed delivery is in that state, counted as the overdue clocks count it, 0040), no ship can take (pending deliveries to a type with no active ship that may claim them, 0034), needs attention (undeliverable; not handled is execution, 0042) and overdue (the standing overdue entries). The blueprint, "Installation", holds their meaning.
- **Facts only:** times, not ages, as last activity; the hosting service measures the age with its own clock and sets its own thresholds (0016).
- **Read, not stored:** subqueries of the one statement that reads the fleet, over its open deliveries, its overdue entries and, for the oldest in flight, the delivery's events; no new table or event.
- **Needs attention:** the fleet's own console lists the deliveries no ship can take in their own group, with no action; each clears by itself once a ship that may take it is commissioned (blueprint, "Needs attention"). The console's Health shows the stuck deliveries with their ages and trend (0042).
- **Retire stays as it is:** a type's pending deliveries outlive the last ship of the type, and the figure shows the wait; a new ship of the type takes them.

Why: work can stall where no one sees it (pending to a type with no ship left, handed on a plain lease held by a dead session, 0010), and only the fleet's own console shows Needs attention.

Rejected: Dismiss on a delivery no ship can take (a new transition for a pending delivery; a new ship of the type takes it); ages or red and amber computed by the server (the server would set policy); abandoning a type's pending deliveries when its last ship retires (a later ship of the type could no longer take them); a figure for deliveries pending to a ship awaiting crew (a wait the operator chose; oldest pending shows a long one); a health table or events kept by the server.
