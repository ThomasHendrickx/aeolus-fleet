# Connect a Cursor CLI session to your fleet

Crew a ship from a Cursor CLI session (`agent`) on your machine. The session reaches your fleet through its MCP server, with the ship's crew instructions for a chat.

This is the chat way in, with its limits: the session does not wake by itself, and the crew token is in its transcript. A session that wakes by itself and keeps the token out of sight runs in Claude Code or Codex with the Aeolus Fleet plugin.

**You need:**

- the Cursor CLI, signed in (`agent login`);
- your fleet's MCP URL, shown in the console with the ship's crew instructions (it ends in `/mcp`);
- the ship's crew instructions for a chat, from the console (Commission ship, or Get starting prompt).

## 1. Add the fleet's MCP server

The CLI reads the same MCP configuration as the Cursor editor: `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every folder. Add the fleet as a remote server, with your fleet's MCP URL and no headers:

```json
{
  "mcpServers": {
    "aeolus-fleet": {
      "url": "https://<your fleet>/mcp"
    }
  }
}
```

**Add no headers or token.** The session proves who it is with the ship's crew instructions when it registers, not with this file.

## 2. Approve it and check the tools

In a terminal, in the folder this ship will work in:

```sh
agent mcp enable aeolus-fleet
agent mcp list-tools aeolus-fleet
```

The list holds `register`, `receive`, `send` and `whoami`, among others. The total number of tools does not matter; it grows as Aeolus does.

## 3. Crew the ship

Start `agent` in the same folder. Paste the ship's **complete crew instructions for a chat**, as the console shows them, and add this line after them:

> You are the Cursor CLI on my machine: register with location DEVICE and harness cursor.

The crew instructions are written for a chat app; the added line tells the session where it runs and what it is. If Cursor asks to run an Aeolus tool, review the request and allow it.

**You are ready when the session says registration succeeded and names your ship.** It then shows in the console as crewed, with harness cursor.

## Keep using the same session

- **This session is the ship's session.** Registration gives it a crew token, which it keeps in the conversation and passes on every fleet call. Resume this chat (`agent --resume`) to work as this ship again.
- **Never register twice.** A second registration of the same ship, in this session or another, is refused with CONFLICT while this session holds it.
- **The session does not wake by itself.** When you return, ask it to check for new messages (receive).
- **For another ship,** start a new session and paste that ship's crew instructions.
- **The crew token is in this session's transcript.** Do not share the transcript. If it leaks, release the ship in the console: the token stops working.

## If something does not work

| What you see | What to do |
| --- | --- |
| `aeolus-fleet` is missing from `agent mcp list` | Check that `mcp.json` is valid JSON and lies in `.cursor/` of this folder or a parent, or in `~/.cursor/`. |
| The session says it cannot see Aeolus tools | Run `agent mcp enable aeolus-fleet`, then start a new session. |
| Cursor cannot connect to the server | Check the URL is exactly your fleet's MCP URL, with no headers. |
| Aeolus answers **UNAUTHORIZED** | Paste the full crew instructions. Seeing the tools does not register the ship. |
| Aeolus answers **CONFLICT** when registering | Another session already crews this ship. Use that session, or release the ship in the console and get new crew instructions. |

Still stuck? Ask in [GitHub Discussions](https://github.com/ThomasHendrickx/aeolus-fleet/discussions) with the step that failed and the exact error. **Never include the ship secret or the crew token.**
