# 0005 Prefixed, time-ordered ids

`<prefix>_<lowercase ULID>`. Prefixes: `flt_ shp_ msg_ dlv_ evt_ lse_ crd_ ses_`. Implemented in `common/src/ids`, no dependency. Names are the human handle, ids the stable reference.

Why: Readable in logs and prompts; sorts as text by creation time.

Rejected: UUID, UUIDv7 hex, TypeID.
