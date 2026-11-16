# After: proposed terminal mockups

Proposed text for approval, not running output. Example: a fresh computer, Claude Code and Codex installed and signed in, no flags answering wizard choices, one repository and no folders. Part numbers count parts, never questions. Input after each prompt is the example person's answer.

## A1: explain before asking

```text
Join this computer to your fleet

The trierarch runs agent sessions on this computer. Each session crews
one ship: an agent you can send work to through the fleet.
Sessions use the tools, files and permissions you allow here.

Setup has four parts:
  1. Agent tools and permissions
  2. Repositories and folders
  3. Ship and session limits
  4. Service and connection

Enter accepts the shown default. Type ? for help at a setup question.
Ctrl+C stops setup. Installed files may remain; see the closing status.

Part 1 of 4: Agent tools and permissions
An agent tool (a harness) runs the sessions. Pick at least one.
Claude Code: installed, signed in.
Use Claude Code? [y/N] y
Codex: installed, signed in.
Use Codex? [y/N] y
Copilot: not installed.
Use Copilot? [y/N] n

Claude Code normally uses its own permission controls.
Yes lets its sessions run tools without permission questions, with
this computer user's access. It also accepts Claude Code's bypass
warning for this user. Other Claude Code runs may see that acceptance.
No keeps normal permission controls; work may be refused or wait.
Run Claude Code without permission questions? [y/N] n

Codex normally uses its own approvals and sandbox.
Yes bypasses both for sessions started by this trierarch, with this
computer user's access. No keeps normal controls; work may be refused
or wait.
Run Codex without permission questions? [y/N] n
```

Fresh selections default to No. An existing configuration shows its current value as the default, labelled `Current setting`, without claiming it is a fresh default. Selecting Copilot shows this before its selection prompt instead of offering a permission switch it cannot honour:

```text
Copilot: installed; sign-in cannot be checked here.
Copilot's headless sessions always run without tool permission questions.
They use this computer user's access. Pick No to leave Copilot out.
Use Copilot? [y/N]
```

## A2: repositories, folders and contextual help

```text
Part 2 of 4: Repositories and folders
For a repository, each ship gets its own git worktree.
A folder used as it is is shared: a session can change its existing files.
These choices select workspaces; they do not sandbox a session's access.

Add repositories from:
  1. Local repository paths or git URLs
  2. A folder containing git repositories (direct children only)
  3. Skip adding repositories
Choose [3]: 1
Git URLs are cloned to ~/repositories unless --clone-into sets another
folder. Local repositories stay where they are.
Local paths or git URLs (comma or semicolon separated): ~/code/web
Added repository web: ~/code/web

Add a folder used as it is? [y/N] ?
A session uses the folder directly, without making a git worktree.
Other sessions or people using it see changes to the same files.
Choose No if you only want the repositories above. Default: No.
Add a folder used as it is? [y/N] n
```

Yes asks `Folder name:` and `Folder path:`, explains a name's accepted format beside the name field, and repeats the add-folder question after each valid pair. A duplicate name names its existing repository or folder and asks for a different name; a bad path asks for that path again. Existing entries are listed and kept. Skip adds none; it does not remove existing entries. Selecting no workspace is allowed, with `No workspace: this computer cannot crew a request until you add a repository or folder.`

## A3: explain and ask both limits

```text
Part 3 of 4: Ship and session limits
The ship limit is how many ships this trierarch may keep on its list,
including ships whose sessions are not running. Fresh default: 4.
How many ships may it keep on its list? [4] 4

The session limit is how many sessions may run at the same time.
Other ships wait for a place. Fresh default: 2.
How many sessions may run at once? [2] 2
```

Use the configured values as defaults on rerun. Values follow existing positive-integer validation; this proposal adds no cross-limit rule. Command-line values are shown as `From the setup line` and do not cause a second prompt. `--yes` uses existing defaults and never silently selects a harness.

## A4: service consent, work in progress and completion

```text
Part 4 of 4: Service and connection
The service runs the trierarch in the background and starts it again
at login. It can start sessions when the fleet assigns work here.
Yes installs and starts it. No stops before joining this computer;
this run will not register it or install or start its service.
Downloaded files and cloned repositories may remain.
Install and start the service? [Y/n] y

Installing the Aeolus Fleet plugin for Claude Code...
Installing the Aeolus Fleet plugin for Codex...
Joining the fleet...
Saving this computer's configuration...
Starting the service...
Checking that the service stays running (at least 10 seconds)...

Ready: this computer is joined to the fleet.
  Claude Code: normal permission controls
  Codex: normal approvals and sandbox
  Repositories: web
  Folders: none
  Limits: 4 ships, 2 sessions at once
  Service: running; starts again at login
Check this computer with: aeolus-trierarch status
```

The existing join-machine design's closing checks remain: version, stable process, valid lease and accepted first report. `Ready` needs all those checks. This summary omits tokens, secrets and the setup line. On rerun, if a service exists, the question is `Update and start the existing service? [Y/n]`; No leaves that service unchanged and says it may still be running. It does not stop a service or its sessions.

## A5: help and invalid input do not advance progress

```text
Part 3 of 4: Ship and session limits
How many sessions may run at once? [2] ?
This limits sessions running at the same time on this computer.
Other ships wait for a place. Enter keeps 2.
How many sessions may run at once? [2] many
Enter a whole number greater than zero, or ? for help.
How many sessions may run at once? [2] 2
```

Every wizard question supports `?`, including yes/no, choices, names, paths and numbers. Help preserves earlier answers and the current default. Secret-bearing command arguments are never echoed as help or recovery text.

## A6: stop with the cause, result and next action

```text
Part 1 of 4: Agent tools and permissions
Claude Code is installed but not signed in.
Run: claude auth login
Then run your setup line again.
Not joined: setup stopped before registration.
```

```text
Part 2 of 4: Repositories and folders
~/code/web is not a git repository.
Enter a local git repository path or a git URL, or ? for help.
Local paths or git URLs (comma or semicolon separated):
```

```text
Part 4 of 4: Service and connection
Install and start the service? [Y/n] n
Stopped before joining: no registration or service change by this run.
Downloaded files and cloned repositories may remain.
Run your setup line again when you want to continue.
```

```text
Part 4 of 4: Service and connection
The Aeolus Fleet plugin could not be installed for Codex.
The installer reported: <reason, with credentials removed>
Not joined: this run did not register the computer or change its service.
Fix the reported cause, then run your setup line again.
```

```text
Part 4 of 4: Service and connection
The fleet did not confirm registration.
It may have accepted it before the connection failed.
Run the same setup line again. If it reports that the ship is already
crewed here without a saved credential, use the recovery instructions
on the computer's ship page. No service was started by this run.
```

```text
Part 4 of 4: Service and connection
Not ready: the service did not stay running.
Last error: <reason, with credentials removed>
The computer is joined and its configuration is saved.
Check: aeolus-trierarch status
Fix the reported cause, then run the same setup line again.
```

Other stops use the same cause/result/action shape: unsupported computer, failed download or verification, no supported harness selected, missing tool, invalid flags, unavailable terminal, clone refusal, fleet refusal, configuration save failure, or interrupted input. Existing precise fleet-recovery instructions remain authoritative; never advise deleting credentials or automatically releasing a ship. No spinner implies success. A process still working names the current action; a blocked question always shows its prompt.
