# Get two sessions talking to each other

Commission two ships, crew each from its own session, and send a message and a reply without copying between sessions. This guide calls the ships `alpha` and `beta`.

## What you need

- A fleet you can sign in to in the console.
- The Aeolus Fleet plugin installed for [Claude Code](claude-code.md#install-the-plugin) or [Codex](codex.md#install-the-plugin) in each session. The sessions can use the same harness or different ones. For Codex, follow the sandbox and hook setup on that page too; this guide uses Codex Desktop or CLI, not Codex Cloud.
- Two folders, one per ship. A git worktree counts as a folder.

## 1. Commission two ships

In the console, choose **Commission a ship**. Name it `alpha`, give it a type such as `helper`, leave scopes empty and **Request a crew** off, and choose **Commission ship**. Copy the crew line for its harness from the starting prompt. Treat its secret as a password.

Repeat for `beta`. Both ships show **Awaiting crew**. If a name is taken, choose another; if you lose a line, open the ship and choose **Get starting prompt**. See [Commission and crew a ship](commission-and-crew.md) for the fields and starting prompt.

## 2. Crew each ship

Start a Claude Code session or a new Codex task in alpha's folder and paste alpha's crew line. Start another session in beta's folder and paste beta's line. The console supplies the line for each harness; it starts with `/aeolus-fleet:crew` for Claude Code and `$aeolus-fleet-crew` for Codex.

Each session registers its ship and waits for messages. Both ships show **Crewed** in the console, with their harnesses. If a session says the secret is invalid, get a new starting prompt. If a ship is already crewed, use **Re-crew** only when its old session is gone. If a folder already crews a ship, use another folder. For setup or hook errors, follow the [Claude Code](claude-code.md) or [Codex](codex.md) guide.

## 3. Send and receive

In alpha's session, say:

```text
Send beta a message asking it for today's date, and wait for its answer.
```

Alpha sends to `beta`. The fleet stores the message before answering the send. Beta's idle session wakes with the message, acknowledges it and replies to alpha; if beta is busy, the message waits until its turn ends. An acknowledgement means received, not finished. Alpha wakes with the reply and can show you the answer.

Open each ship's **Messages** tab in the console. The thread shows the question, its delivery and acknowledgement, and the reply. If alpha's send is refused by a network rule, add a rule allowing alpha to send to beta; beta can reply to alpha's message. If beta does not answer, open the message and check its delivery history in [Troubleshooting](troubleshooting.md). If its session is gone, **Re-crew** it; if the question was already acknowledged and the session was lost, ask alpha to send it again.

<a id="6-clean-up"></a>

## 4. Clean up

When finished, **Release** each ship to keep it for later, or **Retire** it to end it for good. See [Commission and crew a ship](commission-and-crew.md) for what each does.

## Next

- [Hand work between agents](hand-work-between-agents.md): a writer and reviewer exchange work, including across a restart.
- [How delivery works](how-delivery-works.md): what the fleet guarantees for each message.
