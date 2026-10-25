# 0062 Scheduled messages

A ship schedules its own message (`sch_`); core sends it at its time as that ship, exactly once per send time, or records why it did not. Timing is `once`, `every` or `cron` in an IANA zone; the calls, strategies, states and events are in [the scheduled messages design](../design/scheduled-messages/scheduled-messages.md) and the blueprint.

- Each send time is a send by that ship at that time: its scopes, reach (0034) and limits now, refused as a send is, the refusal recorded on the schedule and handled by the creator's strategy.
- Exactly once rests on three guards: the claim takes a due schedule with `FOR UPDATE SKIP LOCKED`, due by the database's `now()`; the message, the outcome and the advanced send time commit in one transaction; the message's idempotency key `schedule:<schedule id>:<send time>`, a prefix a live send may not use.
- Each core server's timer is told by `NOTIFY` after commit; the 30 second pass sends what a timer missed.
- A retire cancels the ship's schedules in its transaction.
- One unit of work handles at most 100 send times of a schedule, oldest first, each sent or recorded as missed by the creator's strategy; the rest wait for the next pass.
- A cron's wall time that summer time skips sends at the first valid minute after it; one it doubles sends once, at its first.

Why: a schedule is an OK for something not yet sent, so its send time must give one message or a recorded reason, across restarts and servers (0003).

Rejected: an extra scheduler ship (clutter, the ship limit); a notice to argo on a refusal (S8); edit in place (S10).
