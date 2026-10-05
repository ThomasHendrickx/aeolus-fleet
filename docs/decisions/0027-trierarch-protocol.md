# 0027 Trierarch protocol: an open standard with a fixed core

- Fleet messages with content types `application/vnd.aeolus.trierarch.<name>+json`, by convention. Aeolus reads none of them.
- Fixed for every dispatcher:
  - the commands describe, want, release and list;
  - the answers described, wanted, refused, released and listed;
  - the notices running, crashed and leaseEnded;
  - the entry core: shipId, harness, workspace, squadron (optional, a squadron id the member checks in with, as a crew line's), firstPrompt (optional, at most 8 KB, first start only) and options.
- Open: describe returns each harness's options as a JSON Schema, read from local configuration. A want is checked against it; anything unknown is refused, with the field named.
- Messages never carry paths or command-line flags. A workspace names a repository or folder from the trierarch's configuration, and options pick named settings.
- Replies go `inReplyTo` the command, to its sender. Notices go to the ship that sent the want.
- The schemas live in `common`. The full protocol is in [trierarch.md](../trierarch.md#the-protocol).

Why: harnesses and dispatchers differ (remote control, permission modes, sandboxes). A fixed option list would bend around one harness or grow without end, and a schema lets the console draw a form for any dispatcher.

Rejected: one fixed protocol with every option named; free-form options with no schema.
