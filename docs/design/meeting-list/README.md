# A ship lists the meetings it takes part in

Design for [#1981](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1981). Stage 1: purpose, lessons and questions. Docs only. Nothing below the purpose is decided until Thomas agrees the purpose; each question then gets its own answer.

## 1. Purpose (for Thomas to agree)

**Who it is for.** A ship that takes part in meetings: first a person ship's crew, the gateway reading for a person or an agent acting as the person through the gateway's MCP; and every agent ship, crewed again after a restart or a cleared session, that holds no meeting id any more.

**The job.** The ship asks core which meetings it takes part in and gets a bounded page of them, open ones first, with enough per meeting to see where it stands without opening each one: the meeting's id and title, open or ended and when, its owner and moderator, how many participants it has, who holds the mic, the ship's own place in line for the mic, and when the last contribution was made. From there it opens one with the existing `meeting` read. Today a ship finds a meeting only through the added notice it received, or an id someone passes it (decision 0061): a notice acknowledged and gone, and the meeting is out of sight.

**What it is not.**
- No contributions or payloads: content-blind, as the meeting's envelope is. Reading what was said stays `meeting`.
- No list of meetings a ship takes no part in: no fleet-wide meeting list for argo, a fleet manager or the console.
- No change to a meeting: no join, leave or mic call from the list.
- No count of unread contributions and no wake: a contribution still arrives as a delivery.
- No gateway page or Aeolus Fleet plugin script in this design's core build: those are their own trains' work on top of the call.
- No room: rooms are not built (meetings design, M20).

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | A participant reads a meeting with `meeting` (`messages:receive`); a meeting it takes no part in and one that does not exist are one refusal; a former participant, left or revoked, still reads it | Decision 0061; `packages/core/src/domain/messaging/read-meeting.ts` |
| L2 | "A participant crewed again, late or after a crash, gets what it missed with no human passing ids." Today that holds only while the ship still has the meeting's id | Meetings design, purpose outcome 4 and M12 |
| L3 | Where a person stands on the mic was missing: the gateway's meeting page kept "number 1 in line" after the mic was given, and `requestMic` over MCP answered no place in line | Onboarding audit, 25 Oct, [#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240) |
| L4 | Content-blind: what Aeolus keeps and shows sits on the envelope. Meeting titles stay readable in a sealed fleet, so a list without payloads needs no data key | Blueprint, not an orchestrator; blueprint, sealed fleets (item 5); decision 0068 |
| L5 | A person's paged list already exists: `exchanges`, 20 a page unless asked, at most 100, read from a rollup written in the delivery transactions, "never counted from history", retired ships left out | Blueprint, `exchanges`; [exchange read design](../exchange-read/README.md) |
| L6 | A list page asks the database for the page plus one row, by an opaque cursor, with no totals, the permission in the query; the target is 3,000 ships and 10,000,000 retained messages per fleet, p95 below 100 ms and p99 below 500 ms | [Person ship reads](../person-ship-reads/README.md); performance skill |
| L7 | `meeting` reads each participant's ship and lease one at a time. Done per meeting in a list of 20, that is a query per participant per row | `read-meeting.ts` |
| L8 | Participants are indexed by fleet and ship (`MeetingParticipant @@index([fleetId, shipId])`); the meeting row holds owner, moderator, mic holder, opened and ended, but no last contribution time | `packages/core/src/adapters/prisma/schema.prisma` |
| L9 | Retention takes finished contributions once their meeting ended, so a time read from messages changes as history goes | Decision 0066 |
| L10 | A retired ship leaves every open meeting, and a meeting it owns ends; a removed ship is a remnant that keeps its id and name | Decisions 0061, 0070 |
| L11 | No call waits: a read answers at once; a ship looks again on a wake | Decision 0072 |
| L12 | One procedure; REST and MCP map onto it; a package of another train names each call it uses in compatibility.md with the core version that brings it | Decision 0004; [compatibility.md](../../compatibility.md) |
| L13 | Pre-1: breaking changes allowed, no compatibility layers, keep the design minimal | Decision 0013; AGENTS.md |

## 3. Questions

Each is one decision, with the options and a pick. None is decided until Thomas answers it.

**Q1. Whose meetings the call lists.**
1. The calling ship's own only, as a ship call with `messages:receive`, the scope `meeting` takes.
2. Also another ship's, for a holder of `fleet:read` within read reach.

Pick 1. The job is a ship finding its own meetings; a list for others is an audit read the purpose leaves out, and it would show who meets with whom to readers `meeting` never lets in (L1).

**Q2. Which of its meetings are listed.**
1. Every meeting it can read with `meeting`: present, left and revoked, open and ended, each with the ship's own state.
2. Present and left only, revoked left out.
3. Present only.

Pick 1. The list then matches what `meeting` answers (L1), so nothing listed refuses on open and nothing readable is hidden; the ship's own state says which it is.

**Q3. The order of a page.**
1. Open meetings first, then ended; within each, newest opened first, the id breaking a tie.
2. Open first, then ended; within each, the newest last contribution first.

Pick 1. Its key never moves, so a cursor continues from the ship's place and no meeting shows twice or is skipped between pages (L6). Option 2 moves a meeting on every contribution while a ship pages.

**Q4. The page size.**
1. 20 a page unless asked, at most 100, as `exchanges`.
2. 20 a page, fixed.

Pick 1. One rule for a ship's paged lists (L5); an agent crewed again may want its open meetings in one call.

**Q5. Where the last contribution's time comes from.**
1. Kept on the meeting, written in the contribution's own transaction.
2. Read from the meeting's messages at each list.

Pick 1. A list of 20 then reads no history (L5, L6), and the time stays when retention takes the contributions of an ended meeting (L9). The cost is one more write in each contribution's transaction, on the meeting row the contribution already reads.

**Q6. What each listed meeting carries.**
1. The issue's set: id, title, open or ended and when it opened and ended, owner and moderator by id and name, how many participants are present, the mic holder by id and name, the ship's own place in line for the mic (none when it holds the mic or has not asked), and the last contribution's time; plus the ship's own state (present, left or revoked).
2. Option 1 without the ship's own state.
3. Option 1 with every participant by id and name.

Pick 1. It answers where the ship stands (L3) from the meeting row, the ship's participant row and the mic requests, with no ship or lease read per participant (L7). Option 3 grows each row with the meeting and repeats what `meeting` reads.

**Q7. The call and its surface in core.**
1. A new ship call, `meetings`, on tRPC with REST and MCP over the same procedure, a ship protocol line and a compatibility row for the gateway; the gateway page and the Aeolus Fleet plugin script follow in their own trains.
2. `meeting` called with no id answers the list.

Pick 1. One call, one answer shape (L12); option 2 gives one call two answers and two refusal sets.
