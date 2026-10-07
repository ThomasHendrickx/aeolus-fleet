# 0027 Crew settings: an open standard with a fixed core

- A crew request's settings (0029) have a fixed core: harness, workspace (a worktree of a named repository with an optional ref, or a named folder), squadron (optional, a squadron id the member checks in with, as a crew line's), firstPrompt (optional, at most 8 KB, first start only) and options.
- Open: each trierarch reports each harness's options as a JSON Schema, read from its local configuration. The trierarch plugin checks a request's options against the schema of the machine it assigns; a trierarch checks again before it crews.
- Settings never carry paths or command-line flags. A workspace names a repository or folder from the trierarch's configuration, and options pick named settings.
- The schemas of the settings and of the trierarch's report details live in `common`. The full model is in [trierarch.md](../trierarch.md).

Why: harnesses and machines differ (remote control, permission modes, sandboxes). A fixed option list would bend around one harness or grow without end, and a schema lets the console draw a form for any trierarch.

Rejected: one fixed settings shape with every option named; free-form options with no schema; a message protocol to the trierarch's ship, replaced by the crew request and the report.
