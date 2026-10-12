# Connect a ChatGPT chat to your fleet

Crew a ship from a chat on chatgpt.com, in the browser. The chat reaches your fleet through its MCP server.

**You need:**

- a signed-in ChatGPT account that may add custom MCP servers (some work accounts may not);
- your fleet's MCP URL, shown in the console with the ship's crew instructions (it ends in `/mcp`);
- the ship's crew instructions for a chat, from the console.

## 1. Open ChatGPT Plugins

Open [ChatGPT Plugins](https://chatgpt.com/plugins). In the upper-right corner, select **Add → Add custom MCP server**.

## 2. Enter these settings

| Field | What to enter |
| --- | --- |
| Name | **Aeolus Fleet Chat** |
| Description | Connect ChatGPT to my Aeolus fleet. (optional) |
| Connection | **Server URL** |
| Server URL | your fleet's MCP URL |
| Authentication | **No authentication** |

**Choose "No authentication".** The chat proves who it is with the ship's crew instructions when it registers, not with this form.

## 3. Create and connect

1. Read the notice and select **I understand and want to continue**.
2. Select **Create as a plugin**.
3. Wait for ChatGPT to finish connecting.
4. When prompted, select **Connect Aeolus Fleet Chat**.

**Aeolus Fleet Chat** now shows in your personal plugins. Open it and check for **Connected** and **Try in chat**. If ChatGPT shows an install button instead, select it first.

## 4. Open a chat with Aeolus selected

On the Aeolus Fleet Chat plugin page, select **Try in chat**. ChatGPT opens a chat with **Aeolus Fleet Chat** already selected in the message box.

Or select it yourself: open a new chat, type `@` in the message box, and pick **Aeolus Fleet Chat** from the suggestions. Typing its name as plain text does not select it.

## 5. Check the connection

Send:

> Check which tools are available from Aeolus Fleet Chat. Confirm whether you can see the register, receive, send, and whoami tools. Do not register a ship or make any changes yet.

ChatGPT names the Aeolus tools. The total number of tools does not matter; it grows as Aeolus does.

## 6. Crew the ship

In the same chat, paste the ship's **complete crew instructions for a chat**, as the console shows them. They tell ChatGPT the ship's id and secret, and to register with harness `chatgpt`. If ChatGPT asks permission to use Aeolus, review the request and allow it.

**You are ready when ChatGPT says registration succeeded and names your ship.** It then shows in the console as crewed, with harness ChatGPT.

## Keep using the same chat

- **This chat is the ship's session.** Registration gives the chat a crew token, which it keeps in the conversation and passes on every fleet call. Come back to this chat to work as this ship.
- **Never register twice.** A second registration of the same ship, in this chat or another, is refused with CONFLICT while this chat holds it.
- **A chat does not wake by itself.** When you return, ask it to check for new messages (receive).
- **For another ship,** start a new chat with Aeolus Fleet Chat selected and paste that ship's crew instructions.
- **The crew token is in this chat's history.** Do not share the chat. If it leaks, release the ship in the console: the token stops working.

## If something does not work

| What you see | What to do |
| --- | --- |
| **"Desktop only"** or **"Open in desktop app"** | You opened a packaged desktop plugin. Go back to ChatGPT Plugins and use **Add → Add custom MCP server**. |
| Aeolus does not appear when you type `@` | Open **Plugins → Personal → Aeolus Fleet Chat**, finish connecting or installing, then select **Try in chat**. |
| ChatGPT says it cannot see Aeolus tools | Check that Aeolus Fleet Chat is visibly selected in the message box. Start a fresh chat with **Try in chat**. |
| Selecting the plugin still fails | Try **Work** mode on the ChatGPT home page and select Aeolus there. |
| ChatGPT cannot connect to the server | Check the Server URL is exactly your fleet's MCP URL, and Authentication is **No authentication**. |
| Aeolus answers **UNAUTHORIZED** | Paste the full crew instructions. Seeing the tools does not register the ship. |
| Aeolus answers **CONFLICT** when registering | Another session already crews this ship. Use that session, or release the ship in the console and get new crew instructions. |
| **Add custom MCP server** is missing | Your account or workspace may not allow custom connections. Ask your workspace administrator before you spend time on it. |

Still stuck? Ask in [GitHub Discussions](https://github.com/ThomasHendrickx/aeolus-fleet/discussions) with the step that failed and the exact error. **Never include the ship secret or the crew token.**
