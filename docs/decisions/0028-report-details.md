# 0028 Report details

A crew's report is its state, its note and optional `details`: one JSON object the server stores without meaning, kept with the lease (the crew), not the ship.

- Size: at most 16 KB (`REPORT_DETAILS_MAX_BYTES` in common, next to the note limit), counted as the UTF-8 bytes of the serialized JSON. A larger one is refused with its size, the limit and this decision ("details is 18211 bytes, the limit is 16384 (decision 0028)").
- Writes: only the crew, for its own ship, through `report`. `details` sets them whole, null clears them; `detailsPatch` applies a JSON Merge Patch (RFC 7386: objects merge per key, null deletes a key, arrays are replaced whole); never both; left out, they stay. The limit applies to the result after a patch.
- Events: `ShipReported` when the state, note or details change, carrying the details version (one more on every change of the details, 0 before any), never the details. A check-in that changes nothing writes no event.
- Meaning lives outside the server: the shape of `details` per ship type is defined in common; the console renders the types it knows and shows the rest raw, folded.

Why a limit: Postgres rewrites the whole row on every update, so the cost of reports is their size times their frequency; a limit bounds the worst case per ship. Why 16 KB: details are status, not storage. Content goes elsewhere and is referenced, as a message carries a reference (0006). For scale, an AWS IoT device shadow document is 8 KB by default.

When it bites: refused reports mean a ship puts content in its status; fix the ship, not the limit. A growing `leases` table means report frequency, not size. Changing the limit means revising this decision.

Rejected: status as broker messages (the broker carries work, never the control channel); details on the ship (they belong to the crew that wrote them); no limit; a typed schema enforced by the server.
