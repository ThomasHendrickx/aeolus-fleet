# 0071 Monitoring

Aeolus monitors execution and never handles it: core keeps the facts ships declare and the trierarch observes, a plugin ship (the watch) compares them with what the owner expects and tells the owner when they part. [The monitoring design](../design/monitoring/monitoring.md) holds the detail (sections 4 and 5).

- Facts in core: a report's task, step and `reportChangedAt` (0028); the lease's activity, written by its assigned trierarch; the expectations on a ship; alerts, `alt_`, open and cleared, one open per ship, signal and occurrence.
- `fleet:alert`, a core scope, raises and clears alerts on the ships its ship reads, idempotent by occurrence key, each with its event in the same transaction. A retire clears the ship's open alerts; a release does not.
- The watch: its own train (0049), its ship owned by argo. Each pass reads the facts, defaults from its configuration (each fleet following them or setting its own) and the expectations, raises an alert once per occurrence, then sends the owner's ship the alert message with the alert id as idempotency key, and the setter's ship too for an expectation another ship set. Nothing is sent on clear; the lists show it gone.
- The alert message, `application/vnd.aeolus.alert+json`, is a fleet convention in the ship protocol, its schema in common (design 4.9). A receiving ship acks it, reads the alert back before acting and sends no reply.
- Expectations (`reportChangesWithin`, `taskDoneBy`) are set through the ship API with `fleet:manage` within manage reach; the console's dialog is optional.
- Aeolus never acts on a signal: no retry, release, recrew, reassignment or escalation (0016).

Why: the owner learns today that something stopped only by looking; keeping every fact in core and the comparing in a plugin keeps core content-blind and free of thresholds of its own (0016, 0041, 0042), and one alert per occurrence with the alert id as key tells the owner once across restarts.

Rejected: core comparing and telling (thresholds of its own, the fleet speaking for a ship, 0040); a message on clear; activity as an event; reading payloads or transcripts.
