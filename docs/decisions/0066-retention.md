# 0066 Retention

A fleet keeps its finished history for its retention, then lets it go; what is still on its way, or still waiting on a person, stays whatever its age. Retention is configuration, as the limits are (0020): the installation sets a default retention in days, and each fleet follows it, or has its own number of days, or none; unset is kept for good. A retention is a whole number of days of at least 1, and Aeolus sets no other minimum or maximum (0016). The installation sets it with `installation.settings.set` and `installation.fleets.setLimits`, which writes `FleetLimitsChanged`; every fleet manager reads it with `fleet.limits` (`fleet:read`), and the console's overview says it under the limits, "kept for good" when none applies.

What is finished, what goes with it and how the pruning pass runs are R2 to R16 of [the retention design](../design/retention/retention.md). The pass prunes finished messages with their deliveries and events, and the mic and participant events of meetings ended before the cutoff; a crew's session and secret events, ended leases, invalidated credentials, ended console sessions, sign-in tickets and reach refusals are not pruned yet. A message a schedule names, as its in-reply-to or its last sent message, is not finished: it is kept while the schedule names it, as a lease a kept row names is (R4), so a schedule's next send never names a message that is gone.

Why: a fleet's database should grow with what it does now, not with everything it ever did; a number of days set per fleet can be priced (Thomas, #1080); nothing goes silently, so every fleet manager sees it.

Rejected: a fixed retention in core (policy, 0016); a demo flag in core (the hosting service deletes its demo fleet, 0022).
