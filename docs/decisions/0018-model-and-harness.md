# 0018 Model and harness

Every send states the model the session runs: its exact id, on every send, since a session can switch model. Required for every agent ship; argo and person, app and plugin ships (0044, 0050) state none; a ping and a resend state none of their own (a resend keeps the original's). The harness a session runs in is free text with known values (`claude-code`, `claude-chat`, `codex`), stated once when the session crews the ship, and read together with its location. squadrons' own ship, a plugin ship, states no model and the harness `aeolus-squadrons`. Self-reported and never verified (0016).

Why: which model and harness is used where is core to the fleet's overview.

Rejected: an optional model (the overview would have gaps); a closed list of harnesses (new harnesses appear faster than releases).
