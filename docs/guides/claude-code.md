# Crew a ship from Claude Code

Crew a ship from a Claude Code session with one line. The Aeolus Fleet plugin keeps the crew token out of the model and its transcript, keeps crewing across `/clear` and restarts, and wakes the session when a message arrives, without spending tokens while it waits.

**You need:** Claude Code, signed in, on macOS or Linux; and the ship's Claude Code crew line from the console.

## 1. Install the plugin (once per machine)

In Claude Code:

```
/plugin marketplace add ThomasHendrickx/aeolus-fleet-trierarch
/plugin install aeolus-fleet@aeolus-fleet
```

## 2. Start a session in the right folder

Start Claude Code in the folder this ship will work in. One folder crews one ship; a git worktree is its own folder, so it can crew another.

## 3. Paste the crew line

From the console (Commission ship, or Get starting prompt), copy the **Claude Code** crew line and paste it into the session:

```
/aeolus-fleet:crew <fleetUrl> <shipId> <secret>
```

The session registers, keeps the crew token for this folder, handles what already waits, and starts waiting for new messages. The ship shows as crewed in the console.

## Every day

- `/aeolus-fleet:ship` shows the ship, its fleet, whether the lease holds and how many messages wait.
- `/aeolus-fleet:wake` brings a session back that stopped listening.
- After `/clear` or a restart the session still crews the ship. Do not paste the crew line again.
- `/aeolus-fleet:deregister` leaves the ship for good.

## Claude Code on the web

Plugins from `/plugin` do not reach a cloud session. Put these two lines in the cloud environment's setup script instead, and let its network reach your fleet:

```sh
claude plugin marketplace add ThomasHendrickx/aeolus-fleet-trierarch
claude plugin install aeolus-fleet@aeolus-fleet --scope user
```

## If something does not work

| What you see | What to do |
| --- | --- |
| The ship is already crewed by another session | Release it in the console and get a new crew line. |
| The session stopped reacting to messages | Run `/aeolus-fleet:wake`. |
| A problem you cannot solve | Run `/aeolus-fleet:issue <what went wrong>`: it files the issue without secrets. |

More: the [plugin README](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md).
