# Before: real terminal output

## Installed trierarch 0.39.1

Captured on the shared computer on 16 Nov with `aeolus-trierarch init --config /tmp/design-1243-capture/config.json`. The temporary configuration had no harnesses, repositories or folders. No fleet arguments were supplied. The computer was already set up; no service or real configuration was changed. This is the actual already-set-up path, not a fresh-install capture.

```text
This machine is set up already: the trierarch crews shp_01m4gjpx1thr1x7j71whc6avv4 at https://fleet.aeolus-fleet.dev.
It has no repository or folder yet, so it can crew no request: add one with aeolus-trierarch add.

```

## Audited fresh setup, 0.31.1

The following is real output from [PR #1232's audit](https://github.com/ThomasHendrickx/aeolus-fleet/blob/97ced63eb0093d03eee101a4d8de4a4dbba0d39d/docs/audits/onboarding-2026-10-25/README.md#the-machines-setup-line-as-the-terminal-printed-it). It is the historical failure behind #1243, not a claim about today's Go wizard. The audit used a throwaway Node 26 container without Claude Code or systemd. Its service failure is part of the evidence.

## The machine's setup line, as the terminal printed it

Node 26 container, answering y to every yes or no question and Enter to every other:

```
Need to install the following packages:
@aeolus-fleet/trierarch@0.31.1
Ok to proceed? (y) y
Claude Code
Launch Claude Code with --dangerously-skip-permissions? Its sessions then run every tool without asking. [y/N] y
Launch Claude Code with --remote-control, so you can follow each session from claude.ai? [y/N] y
Workspaces
Add a repository it may make worktrees of: its name, or nothing when done? ()
Add a folder it may crew a ship in as it is: its name, or nothing when done? ()
Caps
How many ships may it keep on its list? (4)
How many sessions may run at once? (2)
Claude Code asks once per user to accept bypass permissions mode. Accept it now (skipDangerousModePermissionPrompt in /root/.claude/settings.json)? [Y/n] y
claude-code did not say its version, so its options stay as detected before
The service
Install the service and start the trierarch now? It then starts again at every login. [Y/n] y
spawn systemctl ENOENT
```


## Current source boundary

The [Go wizard at 7431adab](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/7431adabdc1564027d682b0b9e7c51d153077002/go/internal/cli/harnessselection.go) now asks which harnesses to use and whether they run without permission questions. Its repository selection accepts paths, URLs, a folder of repositories or skip. Limits are flags, and service installation is automatic. These are source observations, not a captured fresh-install transcript. A complete fresh 0.39.1 capture is still needed on a disposable computer; this design does not run setup against the shared computer's real fleet identity.
