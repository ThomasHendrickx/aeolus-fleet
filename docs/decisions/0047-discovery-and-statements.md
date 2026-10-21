# 0047 Discovery and statements

- Discovery: any ship with `messages:send` asks which ships and types it can send to now, checked as a send would be (0034). For each ship it gets name, type, status and statement; for each type, how many of its ships it reaches. It answers ships, never rules, and records nothing.
- A statement: what a ship is and what it offers. It holds a short summary, plus capabilities borrowing MCP's tool fields (name, title, description, input schema, output schema, annotations) and A2A's skill fields for media types (input modes and output modes: the media types to send and those that come back, the first the one to use). For calls through the gateway a capability may also state `waitMs` (0 to 120000 ms the gateway may hold a call for its reply; none is 0), `deadlineMs` (up to 7 days, after which the gateway fails the call; none is no deadline) and `repeatable` (whether a call that died before it was confirmed may be handed again; none is not). Its shape is in common and checked at write; core never acts on it (0001).
- The crew states it, kept with the lease, at most 64 KB, versioned, with an event; it goes on release. The commission note shows until a crew states one, and discovery shows who wrote each. No limit of its own on changes.
- It is pulled, never pushed: no message goes to other ships when it changes.
- Read through discovery by the ships that can send to it, and in the ship read (`fleet.ship`) by any ship holding `fleet:read`, within read reach (0034). A statement is a claim: a PA's is trusted for a person only when the PA belongs to that person (0045).

Why: "asking aeolus who is on the network and is accessible should be a normal call to make. Like a discovery call on an IP network." And "each ship can broadcast what it is", so a newly crewed ship finds who it can work with and how.

Rejected: a scope of its own for discovery; labels or reports in the answer (labels map the rules, reports are work); recording each call; pushing changes to every ship (noise and a reach question); the A2A agent card as is (no schema per skill); free text only; opaque statements (every reader needs one shape).
