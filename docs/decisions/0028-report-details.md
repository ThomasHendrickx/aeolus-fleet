# 0028 Report details

A crew's report is its state, its note, an optional `task` and `step`, and optional `details`: one JSON object the server stores without meaning, kept with the lease (the crew), not the ship.

- Size: at most 16 KB (`REPORT_DETAILS_MAX_BYTES` in common, next to the note limit), counted as the UTF-8 bytes of the serialized JSON. A larger one is refused with its size, the limit and this decision ("details is 18211 bytes, the limit is 16384 (decision 0028)").
- Writes: only the crew, for its own ship, through `report`. `details` sets them whole, null clears them; `detailsPatch` applies a JSON Merge Patch (RFC 7386: objects merge per key, null deletes a key, arrays are replaced whole); never both; left out, they stay. The limit applies to the result after a patch.
- Task: a typed reference to where the work lives, never its content: a `kind` and that kind's fields. Core checks the kinds it knows, `url` (an absolute https URL of at most 512 characters, never fetched) and `message` (`fleetId` and `messageId` of the right shape, never looked up), and takes any other kind unchecked, so a newer ship never blocks on an older core. Two tasks are the same when their kind and every field are equal.
- Step: `{ at, of }`, whole numbers with 1 <= at <= of <= 1000.
- Task and step are checked; a bad one is refused and nothing is stored. Left out they stay, null clears them.
- `reportChangedAt` moves when the state, note, task or step changes; details alone do not move it. `reportedAt` moves on every call (a check-in).
- Events: `ShipReported` when the state, note, task, step or details change, carrying the task, the step, whether the report changed, and the details version (one more on every change of the details, 0 before any), never the details. A check-in that changes nothing writes no event.
- Meaning lives outside the server: the shape of `details` per ship type is defined in common; the console renders the types it knows and shows the rest raw, folded.

Why: Postgres rewrites the whole row on every update, so the cost of reports is their size times their frequency; a limit bounds the worst case per ship. 16 KB because details are status, not storage: content goes elsewhere and is referenced, as a message carries a reference (0006); an AWS IoT device shadow document is 8 KB by default. A refused report means a ship puts content in its status: fix the ship, not the limit. A growing `leases` table means report frequency, not size. Changing the limit means revising this decision.

Task and step are checked where details are not: monitoring (0071) reads them, the console labels the task per kind, and the sent message joins on it, so their shape is the server's; details stay without meaning. A change of details is no change of the report, so a ship that only streams details does not look like moving work.

Rejected: status as broker messages (the broker carries work, never the control channel); details on the ship (they belong to the crew that wrote them); no limit; a typed schema for details enforced by the server; the task as free text (a reader would parse a string to know what it points at); refusing an unknown task kind (a newer ship would block on an older core).
