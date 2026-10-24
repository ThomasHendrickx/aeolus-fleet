# 0061 Meetings

Thomas's decisions M1 to M22 are in [the meetings design](../design/meetings/meetings.md), section 3, with its flows; this file holds the rules core enforces now.

- A meeting, id `mtg_`, is one moderated conversation of ships: one owner and one moderator, both participants, the ship that opened it at first; a participant is a ship, never a type.
- Opening takes `meetings:open`, joining none. `ship.openMeeting` names the invitees by ship (id or name) and by a label selection (value ids, exact and AND, resolved into ships not retired, never the viewer), folded into one list with the opener, and an optional short title (at most 200 characters) for a person auditing later; an unknown or retired ship refuses it, and so does a list with no ship but the opener. It takes an idempotency key, as commission does: a repeat answers the same meeting, the key with another request is refused.
- Reach is the owner's: it must reach every invitee by send, or the open is refused `NOT_REACHABLE` with the refusal recorded, as a refused send's is, and nothing else stored. Inside, participants reach each other whatever their own reach: the built-in rule `meeting`, always on.
- Each participant but the owner is told by a message from the owner, to that ship, of `application/vnd.aeolus.meeting.added+json`, its payload the meeting's id, title (null without one), owner, moderator and participants by id and name, the meeting's id on the envelope. The open states the owner's model, as a send does.
- A contribution is `ship.send` with the selector `{ kind: 'meeting', meetingId }`: one message, one delivery per other participant, one `MessageAccepted` each, in one transaction, then OK; counted once against the daily message limit. Refused: no such meeting or the sender no participant (one refusal), an ended meeting, a reply (inReplyTo), a forced send, a payload over 64 KB. A contribution gives no answer reach: a direct answer to one is checked as any send.
- A received delivery carries its message's meeting id, none outside a meeting.
- `ship.meeting` reads the meeting for a participant: its title, owner, moderator, when it opened and ended, its participants with name, kind and status, and its contributions newest first, paged; notices are not among them.
- Events: `MeetingOpened` and `ParticipantAdded`, one per participant, the opener included.

Why: the design's purpose and lessons. The notice and the read follow the ship's inbox and the commission's key, so a ship needs nothing new to take part.

Rejected: a type as participant (a type is one claimed delivery, not a fan-out); invitees' own reach between participants (M5); a contribution as a reply (M18); one `MessageAccepted` per contribution (each delivery's state is read from its own events).
