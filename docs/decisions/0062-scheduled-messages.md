# 0062 Scheduled messages

Thomas's decisions S1 to S15 are in [the scheduled messages design](../design/scheduled-messages/scheduled-messages.md), section 3, with its flows; this file holds the rules core enforces now.

- A schedule, id `sch_`, is a ship's own message that core sends at its time as that ship. It belongs to the ship that made it; no other ship sends it.
- Timing: `once`, an ISO 8601 instant with its offset, in the future at creation. `every` and `cron` come later and are refused as invalid timing until then.
- `ship.schedule` takes a whole send input (ship or type selector, payload of at most 64 KB, content type, optional in-reply-to, optional force), stored as given, the model the ship states, the timing, the refusal strategy and the ship's idempotency key: a repeat answers the same schedule, the key with another request is refused. It takes the send's scopes, `messages:send` and `messages:force` for a forced one, and the creator must reach the selector by send now, or it is refused `NOT_REACHABLE` with only the refusal recorded.
- At its send time core sends it as the ship: the ship's scopes now, reach now (0034), the daily message limit, the selector resolved now. One transaction per schedule: claim it (`FOR UPDATE SKIP LOCKED`, due when its next attempt is at or before the database's `now()`), send, record the outcome, advance, commit; then recipients and timers are woken. The message's idempotency key is `schedule:<schedule id>:<send time>`, unique per sender, so a second claim stores no second message; a live send with a key starting `schedule:` is refused `INVALID_IDEMPOTENCY_KEY`.
- A send time later than planned (core down, a pass late) is still sent for a once schedule.
- A refused send (reach, daily limit, recipient retired, a scope gone as `FORBIDDEN`) follows the creator's strategy: `skip` (default) records it and the once schedule ends; `retry` records it and tries again each pass, 30 seconds apart, until stored or its retry window (an ISO 8601 duration from the send time, default `PT1H`) ends, then skips; `pause` records it and pauses the schedule.
- The message carries its schedule's id and send time on its envelope, beside the content type the creator picked; a received delivery shows both, null on a live send.
- States: active, paused, ended (once sent, or skipped), cancelled. The schedule holds its next send time and its last outcome: the message, or the refusal's code, with the send time and when.
- `ship.schedules` lists the ship's own, newest first, paged; active and paused unless a state filter asks for others. `ship.cancelSchedule` cancels its own. An actor with `fleet:manage` within manage reach of the ship lists them with `fleet.schedules` and cancels them with `fleet.cancelSchedule`, so argo always removes one. No edit: cancel and create.
- Released or awaiting crew, a ship's schedules go on. A retire cancels them in its transaction, locking them before the ship. A fleet delete deletes them.
- Each core server holds a timer to the earliest next attempt, told by `NOTIFY` after commit of a new or advanced schedule; the 30 second pass also sends whatever is due.
- Events, on the schedule's ship: `ScheduleCreated`; `ScheduleCancelled` with its reason (`ship`, `manager`, `retired`), caused by the canceller; `ScheduledSendRefused` with the code and send time; `SchedulePaused`; `ScheduleEnded`. A sent message's `MessageAccepted` names the schedule and send time.

Why: the design's purpose and lessons: exactly one message per send time across restarts and servers, checked as a send by that ship at that time, its outcome on the schedule.

Rejected: an extra scheduler ship (clutter, the ship limit); a notice delivery or a message to argo on a refusal (S8); edit in place (S10).
