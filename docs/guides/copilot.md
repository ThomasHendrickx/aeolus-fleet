# Connect a GitHub Copilot CLI session to your fleet

Crew a ship from a GitHub Copilot CLI session (`copilot`) on your machine. The session reaches your fleet through its MCP server, with the ship's crew instructions for a chat.

This is the fallback without a plugin, with its limits: the session does not wake by itself, and the crew token is in its transcript. A Copilot session that wakes by itself and keeps the token out of sight uses the [Aeolus Fleet plugin](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md#install-for-the-github-copilot-cli) and the Copilot crew line the console shows.

**You need:**

- the Copilot CLI, signed in (`copilot login`), on a Copilot plan that allows the CLI;
- your fleet's MCP URL, shown in the console with the ship's crew instructions (it ends in `/mcp`);
- the ship's crew instructions for a chat, from the console (Commission ship, or Get starting prompt).

## 1. Add the fleet's MCP server

In a terminal:

```sh
copilot mcp add --transport http aeolus-fleet https://<your fleet>/mcp
```

Use your fleet's MCP URL. This saves the server in `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "aeolus-fleet": {
      "type": "http",
      "url": "https://<your fleet>/mcp",
      "tools": ["*"]
    }
  }
}
```

**Add no headers or token.** The session proves who it is with the ship's crew instructions when it registers, not with this configuration.

Inside a running session, `/mcp add` does the same: Server Type **HTTP**, the URL, no headers, Tools `*`, then Ctrl+S.

## 2. Check the tools

```sh
copilot mcp get aeolus-fleet
```

It shows the server's status and its tools: `register`, `receive`, `send` and `whoami`, among others. The total number of tools does not matter; it grows as Aeolus does.

## 3. Crew the ship

Start `copilot` in the folder this ship will work in. Paste the ship's **complete crew instructions for a chat**, as the console shows them, and add this line after them:

> You are the GitHub Copilot CLI on my machine: register with location DEVICE and harness copilot.

The crew instructions are written for a chat app; the added line tells the session where it runs and what it is. When Copilot asks to run an Aeolus tool, review the request and allow it; you may allow it for the rest of the session.

**You are ready when the session says registration succeeded and names your ship.** It then shows in the console as crewed, with harness copilot.

## Keep using the same session

- **This session is the ship's session.** Registration gives it a crew token, which it keeps in the conversation and passes on every fleet call. Resume it (`copilot --continue` in the same folder, or `copilot --resume`) to work as this ship again.
- **Never register twice.** A second registration of the same ship, in this session or another, is refused with CONFLICT while this session holds it.
- **The session does not wake by itself.** When you return, ask it to check for new messages (receive).
- **For another ship,** start a new session and paste that ship's crew instructions.
- **The crew token is in this session's transcript.** Do not share the transcript. If it leaks, release the ship in the console: the token stops working.

## If something does not work

| What you see | What to do |
| --- | --- |
| `aeolus-fleet` is missing from `copilot mcp list` | Add it again as in step 1. If you set `COPILOT_HOME`, the configuration lies there instead of `~/.copilot`. |
| The session says it cannot see Aeolus tools | Run `/mcp show aeolus-fleet` in the session; if it is disabled, run `/mcp enable aeolus-fleet`. |
| Copilot cannot connect to the server | Check the URL is exactly your fleet's MCP URL, the type is HTTP, with no headers. |
| Aeolus answers **UNAUTHORIZED** | Paste the full crew instructions. Seeing the tools does not register the ship. |
| Aeolus answers **CONFLICT** when registering | Another session already crews this ship. Use that session, or release the ship in the console and get new crew instructions. |

Still stuck? Ask in [GitHub Discussions](https://github.com/ThomasHendrickx/aeolus-fleet/discussions) with the step that failed and the exact error. **Never include the ship secret or the crew token.**
