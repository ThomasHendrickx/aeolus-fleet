# A ship's statement read with fleet:read

Design for [#1043](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1043). New core fleet functionality, so it goes purpose first. The lessons and questions below are for review; nothing past the purpose is decided until Thomas agrees the purpose. No code.

## 1. Purpose (to agree)

A ship that holds `fleet:read` reads another ship's statement (summary and capabilities), not only through `discover` for the ships it may send to.

The need: Thomas decided on 21 Oct that any ship holding `fleet:read` may read another ship's statement. Today a statement is read only through `discover`, which needs `messages:send` and answers only the ships the caller may send to (0047). A reader such as the viewer, a person who reads only, or argo's console cannot see what a ship says it offers.

The outcomes:
1. A ship with `fleet:read` opens another ship and sees its summary and capabilities, and whether its crew stated them or they are the commission note.
2. The console's ship page shows them.
3. `discover` stays as it is.

Not the purpose:
- Changing who may state a statement, or its shape, size or versioning.
- Pushing a statement to readers (0047 keeps it pulled).
- A statement history.

## 2. What is true today

- **`discover`** (0047, blueprint) answers each ship the caller may send to with its statement, the crew's or else the commission note, saying which. Needs `messages:send`.
- **`setStatement`** keeps the statement with the lease; it goes when the lease ends.
- **`fleet.ship`** answers one ship with `fleet:read` (or `crew:run` for a ship assigned to yours): what `fleet.list` shows plus its report, model, scopes, labels and deliveries. A ship outside read reach shows id, name, type and status only (0034). No statement.
- **The console's ship page** reads `fleet.ship` and shows no statement.

## 3. Lessons to check against

- **0034.** Every `fleet:read` read is filtered by read reach. A ship outside it shows name, type and status only. A plugin reads fleet-wide by its built-in rule.
- **0046.** `fleet:read` reads ships, timelines, messages, labels and events, within read reach.
- **0047.** "Read by the ships that can send to it, and argo." This changes that line; the decision is recorded as Thomas's, so the line is updated, not reopened.
- **0059.** Verified facts show in discovery beside the statement.
- **0006.** A statement is at most 64 KB, so one ship read carries it whole.

## 4. Questions

Each question has options and my pick. They follow once the purpose is agreed.

### S1 Which procedure?

1. **`fleet.ship` answers the statement**, beside the report and model.
2. `fleet.ship` and `fleet.list` both. Up to 64 KB per ship in a list.
3. A new `fleet.statement` read.

**Pick 1.** The ship read is where a reader looks at one ship; a list of full statements grows the fleet view by up to 64 KB a ship.

### S2 Reach

1. **`fleet:read` within read reach**, as every other `fleet:read` field. Outside read reach, no statement.
2. `fleet:read` alone, fleet-wide, regardless of read reach.

**Pick 1.** 0034 filters every read; option 2 makes the statement the one field a read rule does not hide. The issue's "any ship holding fleet:read" reads as the scope, with reach as always.

### S3 The commission note

1. **The same as `discover`:** the crew's statement while one is stated, else the commission note, saying which.
2. The crew's statement only, none when not stated.

**Pick 1.** One rule for what a ship's statement is.

### S4 Verified facts

1. **Not in this slice.** Only the statement.
2. Also the verified facts, as `discover` shows them.

**Pick 1.** The issue names the statement.

### S5 What the console shows

1. **The ship page shows the summary and each capability's name, title and description**, and who wrote it (crew or commission note).
2. Option 1, plus each capability's input and output schema, folded.
3. No console change in this slice.

**Pick 1.** It answers "what does this ship offer" without a schema viewer.

## 5. Docs it would update

- **Decision 0047:** the read line: read by `discover` for the ships that can send to it, and by `fleet:read` within read reach.
- **Blueprint:** the `setStatement` row and the reader's table row.
- **Architecture:** none expected.
