# Retention: what a fleet keeps, and for how long

Design for [#1080](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1080), Aeolus 0.32.0. Docs only. Stage 1: purpose, lessons, questions. Nothing here is decided until Thomas agrees the purpose and answers the questions.

## 1. Purpose (to agree)

A fleet keeps what the delivery promise and its people still need, and lets the rest go, so its database grows with what the fleet does now, not with everything it ever did.

For whom: the hosting service and the fleet manager who pays for a fleet's storage; argo and the fleet's people, who read timelines, threads and meetings; and the crews whose deliveries are still on their way.

Today nothing has a window: events, messages and deliveries, ended leases, invalidated credentials and ended console sessions stay until the fleet is deleted. Production on 21 Oct: 113 MB, of which events 56 MB, messages 22 MB, deliveries 18 MB, growing a few MB a day in the real fleets (#1080). Thomas on the demo: "There is zero value into keeping that".

The outcomes:
1. No delivery still on its way, or still waiting on a person, goes: pending, received, handed, undeliverable and not handled deliveries, and an acknowledged one a crew may still re-read, stay with their messages whatever their age. No message is ever lost.
2. Past its window, a fleet's finished history goes: its messages, their deliveries and their events, and its ended leases, invalidated credentials and ended console sessions.
3. Nothing goes silently: what a fleet keeps and for how long is visible to the fleet's managers, and a timeline says where its history begins.
4. A demo fleet's data costs nothing past its day.
5. Pruning is proven by tests, as the delivery guarantees are: it never takes an open delivery, under concurrency and across a restart.

Not the purpose:
- Backup, export or a deleted fleet coming back (#730; a deleted fleet is gone, 0020).
- Reading or changing payloads (content-blind).
- Retention in squadrons, the trierarch plugin or the gateway: each keeps its own database (0049).

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | No message is ever lost; a delivery is handed again until acknowledged; an undeliverable one is kept on Health until resent or dismissed | blueprint, Purpose; 0040 |
| L2 | An acknowledged, not yet handled delivery stays readable whole until handled (the person's second MCP client) | re-read-delivery design; 0040 |
| L3 | Events are the timeline, the audit trail and the live-update source, append-only by a trigger; only a fleet's delete removes them | blueprint, Domain events; architecture, Core tables and Delete |
| L4 | Abandoned and dismissed deliveries "stay in the timelines"; a retired ship's deliveries "stay in the audit trail and their senders can see it" | blueprint, Retire a ship, Health 5 |
| L5 | A retired ship's id can never be claimed or addressed again | blueprint, Retire a ship 3 |
| L6 | A question is open until argo answers it, whatever its delivery's state | 0038; blueprint, Questions to argo 4 |
| L7 | An ended meeting keeps its messages, deliveries and history, read by former participants; a lasting conversation has no end | meetings design, M15 and Purpose |
| L8 | A scheduled message's outcome is an event in its ship's history | scheduled-messages design, S8 |
| L9 | The stuck snapshot keeps 168 hours and folds the events after its last `seq`: events younger than the newest closed hour must stay | performance design, decision 9; architecture, `health_snapshots` |
| L10 | Storage and messages per day are counters in `message_days`, summed per fleet; the 7 day message measure and the daily limit read them | performance design, decision 1 |
| L11 | Limits are configuration: an installation default, a per-fleet override, unset means none; Aeolus sets no maximum or minimum of its own | 0016, 0020 |
| L12 | No hidden behaviour: every rule visible, every change an event | blueprint, Principles; 0034 |
| L13 | A deleted fleet is gone, every row in one transaction, children first; a bulk delete without indexed foreign keys timed out | 0020; #331 |
| L14 | A read's cost follows what it answers, never the fleet's history | performance design, Purpose 1 |
| L15 | The demo fleet does not pile up: pagasae's demo runner deletes it every night at 03:00 UTC and builds a new one, at most a day (about 50 MB) | #1080, correction comment (a read-only check of pagasae, not verifiable from this repo) |
| L16 | Core knows no demo: no flag on a fleet, the demo runner lives with the hosting service | 0022, 0023, 0024 |
| L17 | Already pruned today: health snapshots past 168 hours, account cut-offs past their 11 minutes | architecture, `health_snapshots` and `installation.accounts.cutOff` |
| L18 | Pre-1.0: no compatibility work | 0013 |

## 3. Questions for Thomas

### Q1. Who sets how long a fleet keeps its history?

The window decides the database's size; the hosting service may sell it, a self-hosted fleet may want forever.

1. **Configuration, as the limits are**: an installation default, a per-fleet override, unset means kept forever (L11). Nothing changes for a fleet nobody sets; the hosting service picks its default.
2. **A fixed window in core** (say 90 days) for every fleet. Simple, but it is core choosing for the operator (0016).
3. **The fleet manager sets it per fleet** in the console, within a maximum the installation sets. More control, more surface.

Pick: 1. It follows the limits exactly, no policy of core's own, and the per-fleet override also serves Q5.

### Q2. When is a message finished, so its window can start?

The promise (L1, L2) keeps every open delivery. The rest is the question: which conversations still need old messages.

1. **Per message, by its own deliveries**: once every delivery of it is handled, dismissed, abandoned, or acknowledged on a lease that is not pushed, and it is older than the window, it goes with its deliveries.
2. **As 1, and also kept while it is an unanswered question to an owner (L6) or a contribution to a meeting or lasting conversation that has not ended (L7).**
3. **Per thread**: a thread goes whole once its newest message is finished and past the window, so no reply loses what it answers.

Pick: 2. 1 would drop an open question from argo's inbox and the start of a lasting conversation; 3 lets one busy thread keep a year of messages.

### Q3. Do events follow the same window?

Events are half the database (56 of 113 MB) and are the audit trail (L3). They also tell of ships, labels, rules and scopes, not only messages.

1. **Same window for every event**: the timeline and audit trail begin where the window begins, and say so.
2. **Message and delivery events with their messages; every other event** (ship commissioned, retired, scopes, rules, labels, owners) **kept for good**. The fleet's who-did-what stays whole; the bulk (sends, receives, hand-overs, turns) goes.
3. **A second, longer window for events**, set like Q1's.

Pick: 2. The bulk is message traffic; the changes to the fleet itself are few and are what an audit asks about.

### Q4. Ended leases, invalidated credentials, ended console sessions and retired ships

They are small but only grow; a retired ship's row holds its name, its owner's ships and its id that may never come back (L5).

1. **Ended leases, invalidated credentials and ended console sessions go after the window; a retired ship's row stays for good.**
2. **All of them stay for good**: little data, no change.
3. **A retired ship goes too once none of its messages or events is left**, keeping only its id so it is never claimed again.

Pick: 1. It takes what only grows and keeps the one row that guards an id.

### Q5. What core does for a demo fleet

Pagasae already deletes the demo fleet every night (L15), so it holds at most a day; core knows no demo (L16).

1. **Nothing in core**: the nightly delete is the pruning; #1080's demo part closes on confirming it in pagasae.
2. **The demo fleet gets a one-day window** through Q1's per-fleet override, which the hosting service sets; still no demo in core. Useful only if the demo should live longer than a night.
3. **A demo flag on a fleet** that core prunes harder. A demo concept in the open package, rejected before (0022, 0023, 0024).

Pick: 1. It already costs nothing past its day.

### Q6. Storage after pruning

Storage is the bytes of every payload the fleet ever stored (L10). Once messages go, that is no longer what the fleet holds.

1. **Storage is what the fleet holds now**: a pruned message's bytes come off its day's counter.
2. **Storage stays ever stored**, a measure of use, not of size.
3. **Both**: ever stored and held now.

Pick: 1. What the hosting service pays for is what is held; ever stored only grows.
