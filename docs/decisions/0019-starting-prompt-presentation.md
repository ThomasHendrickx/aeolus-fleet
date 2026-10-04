# 0019 Starting prompt presentation

Core issues only the ship's secret for a starting prompt. How it reads is presentation, in the tRPC adapter, shared by REST and MCP: the prompt text, one crew line per harness with the aeolus plugin (`claude-code`: `/aeolus:crew <fleetUrl> <shipId> <secret>`, `codex`: `$aeolus-crew <fleetUrl> <shipId> <secret>`), and the secret itself. Commission, get starting prompt and re-crew answer `{ shipId, prompt, crewLines: [{ harness, line }], secret }`; a repeated commission answers all three null. A client that crews a ship for its own session (squadrons, the console connecting squadrons) reads `secret`, never a line. squadrons appends the squadron id to each line it hands a member.

Why: a new harness is one more line in one adapter, and no client depends on the shape of a line.

Rejected: a presenter port in core (formatting is not a domain rule); parsing the secret from the Claude Code line (breaks when lines change).
