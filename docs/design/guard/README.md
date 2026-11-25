# The guard: every tool call of a crewed session checked against a rule set

Design for [#2069](https://github.com/ThomasHendrickx/aeolus-fleet/issues/2069). Purpose and all fifteen questions answered by Thomas; the detailed design (section 4) and the console mockups (section 5) are proposed for his approval. Design only. Children: [#2070](https://github.com/ThomasHendrickx/aeolus-fleet/issues/2070) (the crew request setting), [aeolus-fleet-trierarch#617](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/issues/617) (the hook), [aeolus-fleet-trierarch-plugin#105](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/issues/105) (rule set repositories and the floor).

## 1. Purpose

A person who has a session crewed for them wants certain rules kept whatever the session decides: no push, no skipped git hooks, no writes outside its own repositories. Today those rules live only in skills and prompts, which a session can misread, forget or talk itself out of.

With the guard, the trierarch checks every tool call of a session it starts against a rule set before the call runs, and refuses a call a rule forbids. The session is told which rule refused it and goes on. The person chooses the rule set on the crew request, or none; the fleet's floor applies to every request and a request can only tighten it. The rules come from repositories the fleet connects, resolved to an exact commit when the request is assigned and carried with it, so a restart or a move to another computer applies the same rules. The session cannot change its own guard, and the person sees which version guards each ship and every refusal.

Aeolus provides the mechanism. The rules are the fleet's own: Aeolus writes none into the product (decision [0016](../../decisions/0016-no-policy.md)).

Not in it: what a session does inside an allowed call, rules for ships no trierarch crews, and a sandbox for the operating system (containers stay decision [0039](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/decisions/0039-container-sessions.md)'s).

## 2. Lessons to check against

| Lesson | Source |
| --- | --- |
| Aeolus adds no protective rules; risk is the operator's call. The guard is mechanism, like `--disallowedTools`: the fleet writes the rules. | [0016](../../decisions/0016-no-policy.md), [permission asks](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/permission-asks.md) |
| Crew settings carry names, never definitions, paths or flags, and are at most 16 KB. "Paths a session may touch" as a free setting breaks that rule. | [0027](../../decisions/0027-crew-settings.md), [0029](../../decisions/0029-crew-request.md) |
| Core never acts on crew settings; the plugin places, the trierarch executes and never picks. A place-only check with a written reason already exists for models. | [0029](../../decisions/0029-crew-request.md), [0030](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/decisions/0030-trierarch-plugin.md), [0063](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/decisions/0063-model-governance.md) |
| A session holds no fleet credential; the trierarch acts for it over the ship's socket. A guard that needs the fleet must ask the trierarch. | [0026](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/decisions/0026-trierarch.md) |
| Acknowledgement means receipt. Sending rules is no proof a trierarch applied them; configuration is versioned and confirmed, and an older version never replaces a newer one. | [0001](../../decisions/0001-ack-on-receipt.md), [trusted repositories](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/trusted-repositories.md) |
| Payloads are at most 256 KB; a message is the ticket, the reference is where content lives. Full rules in an assignment must fit. | [Architecture rules](../../../AGENTS.md) |
| The plugin owns its data, its pages and its API; every call checks actor, scopes and fleet; a message is never authority. | [0043](../../decisions/0043-core-surface.md), [0057](../../decisions/0057-actors.md) |
| Squadrons reads templates from repositories through the GitHub API. Guard uses the GitHub API for operator-requested updates (section 4.2). | [0017](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/decisions/0017-squadrons-package.md) |
| Claude Code runs hooks, then deny rules, then the permission tool. A hook that errors or times out lets the call run unless it answers a denial: a guard fails open by default. | [Permission asks](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/permission-asks.md), Claude Code hook behaviour |
| A check on the command text is bypassed by anything that builds the command at run time: `sh -c`, `eval`, variables, aliases, an interpreter's `-c`, a script written and then run, `git -c core.hooksPath=`, `--no-verify`, `GIT_*` variables. A path check is bypassed by `..`, symlinks, `cd` before a relative path, and tools other than the shell (Write, Edit, MCP tools). | General bypass classes of PreToolUse guards; the known bypasses of the prior art, an existing Claude Code PreToolUse guard, join them as regression cases ([aeolus-fleet-trierarch#617](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/issues/617)) |
| A session runs as the computer's user on the host: it can edit the harness's settings, the hook's files or its rules, unless the guard protects them or the session runs in a container that cannot reach them. | [0039](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/decisions/0039-container-sessions.md) |
| Nobody watches a session's pane; a refusal must never wait for a person. | [Trierarch runtime](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/trierarch.md) |
| Codex, Copilot and Cursor are harnesses too, each with different or no hooks. | [Trierarch harnesses](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/tree/main/docs/design/harnesses) |
| Before 1.0.0, keep the design minimal: no compatibility layers. | [0013](../../decisions/0013-breaking-changes-before-1-0.md) |
| A guarantee without a test does not exist: every known bypass becomes a regression test. | [0014](../../decisions/0014-tests-from-scenarios.md), [aeolus-fleet-trierarch#617](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/issues/617) |

## 3. Questions

Each question has its context, the options, the pick and why. Thomas answers them one by one; the detailed design follows the answers.

### Q1. Purpose

Context: section 1.
Options: 1 approve as written; 2 change it.
Pick: 1. It names the person's need, the mechanism and what stays out.
Answer: approved by Thomas, option 1, as written.

### Q2. Where the check runs

Context: Claude Code offers a PreToolUse hook (sees every tool call, the shell's and the file tools' and MCP's, before deny rules), deny rules (`--disallowedTools`, matching only by tool and prefix) and the permission tool (reached only for calls that would ask, so not for allowed calls).
Options: 1 a PreToolUse hook the trierarch installs in a settings file it writes per session, outside the session's folder; 2 deny rules only; 3 the permission tool.
Pick: 1. Only the hook sees every call with its whole input; deny rules cannot express paths or git actions, and the permission tool never sees an allowed call.
Answer: approved by Thomas, option 1, with his note: "This needs to work for all harnesses! PreToolUse is fine if all other supported harnesses are covered as well in the same or other ways." Decision: Claude Code is guarded by a PreToolUse hook the trierarch installs in a settings file it writes per session, outside the session's folder; every other supported harness (Codex, Copilot, Cursor) is guarded too, by its own hook where it has one or another way where it has none, worked out per harness in the detailed design.

### Q3. When the guard itself fails

Context: a hook that crashes, times out or cannot read its rules lets the call run by default.
Options: 1 fail closed: any error, timeout or missing rules refuses the call, naming the cause; 2 fail open, logged.
Pick: 1. A guard that lets calls through when it breaks guarantees nothing; a refused call is visible and the session goes on.
Answer: approved by Thomas, option 1, fail closed. Decision: any error, timeout or missing rules refuses the call, naming the cause.

### Q4. What a rule matches

Context: a rule that matches command text is defeated by every bypass class in section 2.
Options: 1 command text patterns; 2 the parsed command: the shell input is parsed into commands and their arguments, and what cannot be resolved before it runs (`eval`, `sh -c` or an interpreter's `-c` with input built at run time, a command name from a variable or substitution) is refused while a rule set applies; 3 an allow list of commands only.
Pick: 2. It closes the classes text matching leaves open, without forcing every fleet to list every command it allows.
Answer: approved by Thomas, option 2, the parsed command. Decision: the shell input is parsed into commands and their arguments, and what cannot be resolved before it runs is refused while a rule set applies.

### Q5. The rule types of the first version

Context: the issue names commands, paths and git actions.
Options: 1 commands, write paths and git actions; 2 those and the tools a session may call (MCP tools included); 3 those and read paths.
Pick: 2. A tool rule is cheap and closes the file-tool and MCP side; read paths add little against the issue's rules and cost a check on every read.
Answer: approved by Thomas, option 2. Decision: the first version has rules for commands, write paths, git actions and the tools a session may call, MCP tools included; read paths are not in it.

### Q6. Paths a session may touch

Context: the issue fills "paths a session may touch" from the crew request; 0027 forbids paths in crew settings.
Options: 1 no free paths: the guard's path boundary is the ship's own folder and the repositories the crew settings already name, which the trierarch knows; a rule set narrows it with globs relative to those repositories; 2 a new crew setting holding globs, changing 0027; 3 paths only inside rule sets.
Pick: 1. It keeps 0027 and needs no new setting: a session's own repositories are the boundary the issue's example wants.
Answer: approved by Thomas, option 1, no free paths. Decision: the guard's path boundary is the ship's own folder and the repositories its crew settings name; a rule set narrows it with globs relative to those repositories; crew settings get no path setting (0027 stands).

### Q7. Where a rule set's name is checked

Context: #2070 says an unknown name is refused on the crew request; core does not act on settings and does not know the plugin's rule sets.
Options: 1 the plugin at placement, as for models (0063): an unknown name leaves the request unassigned with the reason `rule set unknown: <name>`, and the console offers only the plugin's names; 2 core asks the plugin at request time and refuses.
Pick: 1. It keeps core free of plugin data and follows a recorded pattern; the console's choice list stops the common mistake.
Answer: approved by Thomas, option 1. Decision: the plugin checks the name at placement, as for models (0063): an unknown name leaves the request unassigned with the reason `rule set unknown: <name>`; core checks only the setting's shape; the console offers only the plugin's names.

### Q8. Floor and chosen set together

Context: the floor applies to every request; a request can only tighten it.
Options: 1 a call runs only when the floor and the chosen set both let it (each set refuses on its own); 2 the chosen set replaces the floor's allows but keeps its denies.
Pick: 1. Tightening then holds by construction: no chosen set can loosen anything the floor refuses.
Answer: approved by Thomas, option 1. Decision: a call runs only when the floor and the chosen set both let it; each set refuses on its own, so no chosen set loosens the floor.

### Q9. What travels with the assignment

Context: the trierarch holds no read token for private rule set repositories, and a moved session must apply the same rules.
Options: 1 the plugin sends the full resolved rules of the floor and the chosen set, each with its repository and commit, and the trierarch keeps them with the session, outside the worktree; 2 only repository and commit, the trierarch reading them itself.
Pick: 1. No token reaches a computer, and a crashed or moved session needs nothing but what it was given. A size limit well under 256 KB is set in the detailed design.
Answer: approved by Thomas, option 1. Decision: the plugin sends the full resolved rules of the floor and the chosen set, each with its repository and commit, and the trierarch keeps them with the session, outside the worktree; no read token reaches a computer.

### Q10. A rule set that changes while a session runs

Context: the issue wants the same version on restart and move.
Options: 1 pinned for the crew request's settings version: a new request version resolves the stored copy again; 2 applied live at each new commit.
Pick: 1. What guards a session is then a fact of its request, as its model is under 0063; a live change mid-task surprises the session and the person.
Answer: approved by Thomas, option 1. Decision: the resolved rules are pinned for the crew request's settings version, across restarts and moves; a new settings version resolves the stored copy again.

### Q11. A session cannot change its own guard

Context: on the host a session can edit the harness's settings and the guard's files; in a container it cannot reach them.
Options: 1 the guard always refuses writes to its own files, its rules and the harness's settings, as part of the mechanism, and the docs state that only a container session cannot reach them at all; 2 guard only in containers; 3 host best effort, unstated.
Pick: 1. It protects the mechanism, not a policy (0016), and says plainly where the guarantee is complete.
Answer: approved by Thomas, option 1. Decision: the guard always refuses writes to its own files, its rules and the harness's settings, as part of the mechanism; the docs state that only a container session cannot reach them at all.

### Q12. Harnesses without a guard

Context: Claude Code first; Codex's hooks may or may not allow it; Copilot and Cursor have none known. With a floor, every request has rules.
Options: 1 the plugin places a request with rules (the floor's or a chosen set) only on a trierarch that reports a guarded harness for it, else `no guarded harness: <harness>`; 2 crew it unguarded with a warning.
Pick: 1. An unguarded session under a floor breaks the floor's promise. The cost: while a floor is set, Codex, Copilot and Cursor requests wait until their guard exists.
Answer: approved by Thomas, option 1. Decision: the plugin places a request with rules (the floor's or a chosen set) only on a trierarch that reports a guarded harness for it, else the request stays unassigned with `no guarded harness: <harness>`. With Q2, every supported harness gets a guard; this rule covers a harness whose guard is not yet built.

### Q13. What is visible

Context: the issue asks every resolved version and every refusal to be visible.
Options: 1 the resolved sets and commits on the crew request's status, shown on the ship page; each refusal in the crew's session activity with its rule, set and commit, and a refusal count on the ship page; 2 a message to the owner per refusal; 3 logs on the computer only.
Pick: 1. It reuses the status and activity the trierarch already reports (0029); a message per refusal would flood the owner.
Answer: approved by Thomas, option 1. Decision: the resolved sets and commits are on the crew request's status, shown on the ship page; each refusal is in the crew's session activity with its rule, set and commit; the ship page shows a refusal count.

### Q14. Who manages rule set repositories and the floor

Context: the plugin owns this data; trusted repositories propose a plugin scope of their own.
Options: 1 a plugin scope `trierarch:guard` to add and remove repositories and mark the floor, read by fleet:read; choosing a set on a request stays fleet:manage like any crew setting; 2 fleet:manage for all.
Pick: 1. Weakening the floor is a different right from asking for a crew; with fleet:manage alone any requester could remove the floor.
Answer: approved by Thomas, option 1. Decision: a plugin scope `trierarch:guard` adds and removes rule set repositories and marks the floor; fleet:read reads them; choosing a set on a crew request stays fleet:manage, like any crew setting.

### Q15. Where the console shows it

Context: before and after mockups follow these answers.
Options: 1 the plugin's own page lists the rule set repositories, their sets, errors and the floor; the crew request form gets a rule set choice (None means the floor only); the ship page shows the resolved sets and refusals; 2 a core Settings page for repositories and floor.
Pick: 1. The plugin owns its pages (0043); core shows only the setting and the request's status.
Answer: approved by Thomas, option 1. Decision: the trierarch plugin's own page lists the rule set repositories, their sets, errors and the floor; the crew request form gets a rule set choice, None meaning the floor only; the ship page shows the resolved sets and refusals. Before and after mockups follow in the detailed design.

## 4. Detailed design

The decisions below follow from the answers to Q1 to Q15. They are proposed for Thomas's approval with the mockups in section 5. Each part names the child that builds it: core ([#2070](https://github.com/ThomasHendrickx/aeolus-fleet/issues/2070)), the trierarch plugin ([plugin #105](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/issues/105)) and the trierarch ([trierarch #617](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/issues/617)).

### 4.1 The rule set file (plugin #105, schema in common)

A rule set is one YAML file, `<name>.yaml`, in a connected repository's folder. Its JSON Schema lives in common (`common/src/trierarch/guard-rules.ts`, exported as JSON Schema too), so the plugin, the trierarch and an editor check the same thing. Unknown fields are refused. There is no version field: the commit is the version (Q10), and before 1.0.0 the schema changes with the release (0013).

```yaml
name: no-push            # the file name without .yaml; a trierarch name (lowercase letters, digits, . - _)
description: Never push, never skip hooks.
rules:
  commands:
    deny:                # each: a command name, optionally its first arguments, literal
      - { command: npm, args: [publish] }
      - { command: curl }
    allow: []            # when not empty: only these commands run (shell builtins too must be named)
  git:
    deny: [push, force-push, skip-hooks, rewrite-history, delete-branch, change-remote, change-config]
  writePaths:            # globs relative to the ship's repositories (Q6); never absolute, never ..
    allow: ["docs/**"]   # when not empty: writes only here, inside the boundary
    deny: ["**/.github/**"]
  tools:
    deny: [web, "mcp:linear/*"]
    allow: []            # when not empty: only these tools
```

- Four rule types (Q5): `commands`, `git`, `writePaths`, `tools`. Each is optional; an empty file with only `name` is valid and refuses nothing beyond the mechanism (4.6).
- Git actions are a closed list, matched on the parsed `git` command after its global options (`-C`, `-c`, `--git-dir`) are read: `push` (any push), `force-push` (`--force`, `-f`, `--force-with-lease`, `+refspec`), `skip-hooks` (`--no-verify`, `-n` on commit, `-c core.hooksPath=`, `config core.hooksPath`), `rewrite-history` (`rebase`, `reset --hard`, `commit --amend`, `filter-branch`, `filter-repo`), `delete-branch` (`branch -d/-D`, `push --delete`, `push :ref`), `change-remote` (`remote add/set-url/remove`), `change-config` (any `git config` write).
- Tools are harness-neutral kinds, each harness's guard mapping its own tools onto them: `shell`, `file-write`, `file-read`, `web`, `agent` (starting a subagent), `mcp:<server>/<tool>` with `*` globs. A tool the harness's guard does not know is refused while any rule set applies, as `unknown tool: <name>` (Q3: fail closed).
- At most 64 KB per file, and at most 64 KB for every set one request resolves to together (4.4).

### 4.2 Rule set repositories and the floor (plugin #105)

The plugin keeps, per fleet, one versioned guard configuration in its own database, replaced whole from an expected version, as the MCP configuration is ([fleet crew MCP](../fleet-crew-mcp/README.md), section 4): its repositories `{ repository: "<owner>/<name>", folder, access: "public" | "private" }`, a read token per private repository (write-only, stored and protected as the MCP secrets are), and the floor: a list of rule set names.

Thomas, 25 Nov, [trierarch plugin #113](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/issues/113):

> The guard is copied to aeolus. Default behaviour for now is that they only get updated by an operator. Later we can add automated updates but for now not. This solves connection issues to GitHub etc.

- The plugin offers the stored copy. An operator update or the first add of a repository reads GitHub. It reads the latest commit of the repository's default branch through the GitHub API. When the commit changes, it reads the folder's tree and the `.yaml` files whose blobs changed. Each is checked against the schema and its `name` against its file name.
- An update that fails keeps the stored copy and reports why. Resolve new settings versions against the stored commits, including during a GitHub outage. Existing settings versions keep their pinned commits.
- Each valid file in the stored copy is a rule set of that repository at that commit. The file errors in that copy are shown with their file and reason, and those files are excluded from the offered rule sets.
- A name in two repositories is a conflict: neither is offered, both show the conflict (issue #2069, point 2).
- The floor names rule sets. A floor name that is not offered (gone, invalid, in conflict) leaves the floor unresolvable: every request with any rules waits with `floor unavailable: <name>` until it is fixed (Q3).
- Calls, on the plugin's tRPC router through the console route, as the MCP page's: `guard.get` (fleet:read: repositories, sets, errors, conflicts, floor, version; never a token) and `guard.replace` (`trierarch:guard`, Q14: `expectedVersion`, the repositories, retained token names and new token values, the floor). `trierarch:guard` is declared by the plugin in its own namespace and granted through the scope catalogue. A replace reads only newly added repositories. `guard.update` (`trierarch:guard`) reads the selected repository and answers with the same catalogue as `guard.get`, including the reason if the read failed.

### 4.3 The crew request setting (core #2070)

Crew settings gain `ruleSet` (optional): one rule set name, a trierarch name, never a definition or path (0027). It is a field, not an option, for the reason MCP servers are: a computer that does not declare an option ignores it, so a session would start unguarded. Core checks only its shape (Q7); 0027's fixed core is updated with it. Every door carries it (tRPC, REST, MCP, the OpenAPI and MCP lists), and the console's crew settings fields offer the plugin's names (section 5).

### 4.4 Placement and the rules message (plugin #105)

After the plugin's existing placement checks, for a request whose settings version it has not resolved yet:

1. The effective sets are the floor's names and the request's `ruleSet`. An unknown `ruleSet` waits with `rule set unknown: <name>` (Q7); an unresolvable floor with `floor unavailable: <name>`.
2. With any set, a trierarch fits only when its report names the request's harness (or its default) as guarded (Q12, 4.7); none fitting waits with `no guarded harness: <harness>`.
3. It resolves each set to the commit it last read and stores the resolution with the ship and the settings version. A give-back and a new assignment for the same settings version reuse it: a moved session applies the same rules (Q10). A new settings version resolves again.
4. Over 64 KB together: waits with `rule sets too large`.
5. It sends the trierarch, before claiming the assignment, one `application/vnd.aeolus.trierarch.guard-rules+json`: `{ fleetId, pluginShipId, shipId, settingsVersion, sets: [{ name, repository, commit, file, floor, rules }] }`, with the full rules (Q9). It is sent for every assignment, with `sets: []` when no rules apply, so the trierarch never has to guess. It goes through 0030's durable delivery attempts. Then it claims the assignment.

### 4.5 The trierarch keeps the rules (trierarch #617)

- It takes the rules message only from its fleet's plugin ship, checks it against the schema, stores it in the ship's state folder outside the worktree (`<state>/ships/<shipId>/guard/rules.json`), then acks. An equal settings version with other content is refused; an older one never replaces a newer one.
- It starts a session only with the rules for its request's current settings version. An assignment whose rules have not arrived after 10 minutes is given back with `guard rules did not arrive`.
- A restart reads the stored rules; nothing is fetched again.

### 4.6 The guard on each call (trierarch #617)

Every session the trierarch starts gets the guard for its harness (Q2). For Claude Code: the trierarch writes `<state>/ships/<shipId>/guard/settings.json` with one `PreToolUse` hook, matcher `*`, command `aeolus-trierarch guard check --ship <shipId>`, and passes it with `--settings`. Before the start it reads the effective settings the session would load; any that disable hooks (`disableAllHooks`) make the trierarch give the request back with `guard disabled by settings: <file>`.

`guard check` reads the call from stdin and answers within its own 5-second deadline, below the hook's timeout. In order:

1. Anything that goes wrong (rules unreadable, input it cannot read, a panic, its deadline): refuse with `guard failed: <cause>` (Q3). It answers with the harness's deny and exits with the blocking code, so neither a crash nor a timeout lets the call through. A test proves what the harness does on each.
2. The mechanism's own protection, whatever the rules (Q11): a write to the guard's state folder, the trierarch's configuration, or the harness's settings (for Claude Code: `~/.claude/settings*.json` and every `.claude/settings*.json` in the ship's folder) is refused as `protected: <path>`.
3. The tool's kind (4.1). The shell input is parsed as POSIX shell into its simple commands: pipelines, lists, subshells, `cd` tracked for relative paths, `sh -c` and `bash -c` with a literal string parsed again (Q4). While any set applies, what cannot be resolved before it runs is refused as `unresolvable: <what>`: `eval`, `source` or `.` of a non-literal, a command name from a variable or a substitution, `xargs` or `find -exec` running a non-literal.
4. Paths: every write target (the file tools' paths; redirections; the operands of `cp`, `mv`, `rm`, `touch`, `mkdir`, `ln`, `tee`, `sed -i`, `chmod`) is made absolute from the session's working folder, `..` removed and symlinks resolved, and must lie inside the boundary: the ship's folder and its repositories (Q6). A set's `writePaths` narrow it further.
5. Each set on its own (Q8): the call runs only when every set lets it. The first refusing rule names the refusal.

The session sees the refusal as the tool's error: `Refused by the guard: git.deny push, in no-push @ 8d41e07.` and goes on. The guard appends each refusal to `<state>/ships/<shipId>/guard/refusals.jsonl` (protected) as `{ at, tool, rule, set, commit, summary }`, the summary the call cut to 200 characters.

What the guard cannot see, stated in the trierarch's docs: what a program does once it runs (a script it wrote, an interpreter's own code, a build tool). The guard checks the call, not the program; a container session (0039) limits what that program reaches, and a repository's own branch protection limits a push. A session on the host can reach the guard's files through such a program; only a container session cannot reach them at all (Q11).

### 4.7 Every harness (trierarch #617)

The trierarch report details gain `guardedHarnesses`: the harnesses this computer runs with a working guard. A harness enters it only once its guard exists and its regression tests pass on that computer. Claude Code is first (PreToolUse). Codex, Copilot and Cursor follow, each with its own hook or another way (Q2's note: "This needs to work for all harnesses!"), each designed and tried in its own part of trierarch #617 before it reports guarded; until then a request with rules is not placed on it (Q12).

### 4.8 What is visible (core #2070, trierarch #617)

- `fleet.reportCrewStatus` gains `guard`: `{ sets: [{ name, repository, commit, floor }], refusals: <count>, recent: [<the last 20 refusals: at, tool, rule, set, commit>] }`, written by the trierarch from what it applied and from `refusals.jsonl`. Core stores it with the status, never acts on it.
- Session activity gains the kind `refused`, with the tool's name, so the latest event shows a refusal as it happens.
- The ship page's crew request card shows Rule set, Guard (each set at its commit, the floor marked) and Refusals; the Trierarchs page gains Rule sets (section 5).

### 4.9 Tests (each child)

- Plugin: reading only changed files; an invalid file shown, never offered; a name conflict offers neither; an unresolvable floor holds every request with rules; placement reasons; resolution reused for the same settings version and redone for a new one; the rules message sent before the claim, with `sets: []` too.
- Trierarch: rules taken only from the plugin ship; older never replaces newer; no start without rules; a restart uses the stored rules. Guard: every bypass class of section 2 as a regression case (`sh -c`, `eval`, variables, aliases, `-c` interpreters, scripts, `git -c core.hooksPath=`, `--no-verify`, `GIT_*`, `..`, symlinks, `cd` then a relative path, the file tools, MCP tools), fail closed on crash, bad input and timeout, protected files, unknown tools.
- Core: the setting through every door, the guard status and the `refused` activity kind.

Rollout: on one computer first (trierarch #617).

## 5. Mockups

Drawn with the console's own parts (RequestCrewDialog with CrewSettingsFields, CrewRequestCard, ConsoleFrame, ListPage and TrierarchTabs, Table, Switch, EmptyState, Dialog) and `@aeolus-fleet/ui`, rendered in the console's Storybook in Chromium at 375 and 1440 wide, light and dark: before from `main`, after with the change drawn into those parts. Each board holds every state of one screen. Names are placeholders. Proposed for Thomas's approval; once approved they are the acceptance criteria of the console part of #2070 and plugin #105.

### Crew settings fields

The request crew dialog; the commission dialog and each squadron member use the same fields. After: Rule set under MCP servers. States: 1 None chosen; 2 `no-push` chosen; 3 the plugin offers no rule sets; 4 no floor. One drawing difference: the Select lists the names in the regular font, as SettingsSelect draws every option.

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Crew settings fields before, 375 light](mockups/settings-before-375-light.png) | ![Crew settings fields after, 375 light](mockups/settings-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Crew settings fields before, 375 dark](mockups/settings-before-375-dark.png) | ![Crew settings fields after, 375 dark](mockups/settings-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1440 light](mockups/settings-before-1440-light.png) | ![Crew settings fields after, 1440 light](mockups/settings-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1440 dark](mockups/settings-before-1440-dark.png) | ![Crew settings fields after, 1440 dark](mockups/settings-after-1440-dark.png) |

### Ship page: the crew request card

The card alone, without the rest of the ship page. After: Rule set, Guard (each set at its commit, the floor marked) and Refusals rows. States: 1 running, guarded, no refusals; 2 running, 3 refusals; 3 waiting, `rule set unknown`; 4 waiting, `no guarded harness`.

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Ship page: the crew request card before, 375 light](mockups/ship-before-375-light.png) | ![Ship page: the crew request card after, 375 light](mockups/ship-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Ship page: the crew request card before, 375 dark](mockups/ship-before-375-dark.png) | ![Ship page: the crew request card after, 375 dark](mockups/ship-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Ship page: the crew request card before, 1440 light](mockups/ship-before-1440-light.png) | ![Ship page: the crew request card after, 1440 light](mockups/ship-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Ship page: the crew request card before, 1440 dark](mockups/ship-before-1440-dark.png) | ![Ship page: the crew request card after, 1440 dark](mockups/ship-after-1440-dark.png) |

### Trierarchs page: Rule sets

Before: the Trierarchs page with its Machines and MCP servers tabs. After: a third tab, Rule sets, at `/trierarchs/rule-sets`. States: 1 empty; 2 populated, `base` the floor; 3 a file error and a name conflict; 4 read only, without trierarch:guard; 5 the Add repository dialog (full screen on phone).

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Trierarchs page: Rule sets before, 375 light](mockups/rule-sets-before-375-light.png) | ![Trierarchs page: Rule sets after, 375 light](mockups/rule-sets-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Trierarchs page: Rule sets before, 375 dark](mockups/rule-sets-before-375-dark.png) | ![Trierarchs page: Rule sets after, 375 dark](mockups/rule-sets-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Trierarchs page: Rule sets before, 1440 light](mockups/rule-sets-before-1440-light.png) | ![Trierarchs page: Rule sets after, 1440 light](mockups/rule-sets-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Trierarchs page: Rule sets before, 1440 dark](mockups/rule-sets-before-1440-dark.png) | ![Trierarchs page: Rule sets after, 1440 dark](mockups/rule-sets-after-1440-dark.png) |

#### Operator update

Each drawing starts with the populated Rule sets tab from the approved design. The Update control sits in the repository row on desktop and in the repository card on phone. It uses the same `trierarch:guard` access as Add repository. The empty and read-only views have no update control.

| Width | Light | Dark |
| --- | --- | --- |
| 1440 px | [Before, ready, working, done and failed](mockups/rule-sets-update-1440-light.png) | [Before, ready, working, done and failed](mockups/rule-sets-update-1440-dark.png) |
| 375 px | [Before, ready, working, done and failed](mockups/rule-sets-update-375-light.png) | [Before, ready, working, done and failed](mockups/rule-sets-update-375-dark.png) |

- **Ready.** The operator can update the selected repository.
- **Working.** The control shows the console's existing “Updating” wording and is disabled for that repository. The stored commit and rule sets stay visible.
- **Done.** The commit in the repository and its rule sets reflects the stored copy. If GitHub returns the same commit, the control still confirms success and the commit stays the same.
- **Failed.** The repository shows the reason and the stored commit and rule sets stay visible. The operator can use the same control to try again.

Thomas approved the drawings and selected one Update control per repository. The result stays inline: “Updated” on success, or “Update failed” with the reason and “Kept the stored copy.” when a failed read leaves an earlier copy in use. The introduction says “New requests use the stored copy.” File errors say “Fix the file in its repository, then select Update.”

## 6. The flow

```mermaid
flowchart TD
  subgraph Plugin[trierarch plugin]
    R0[operator adds or updates a repository] --> R1[latest commit for the repository]
    R1 -->|unchanged| R9[keep the stored copy]
    R1 -->|cannot read| RE[keep the stored copy and show the reason]
    R1 -->|changed| R2[read changed .yaml files]
    R2 --> V{valid, name matches file?}
    V -->|no| E[error shown; not offered]
    V -->|yes| N{name unique across repositories?}
    N -->|no| D[conflict shown; neither offered]
    N -->|yes| O[offered]
  end
  CR[crew request, settings version n, optional ruleSet] --> P0{existing placement checks}
  P0 -->|no fit| W0[waits with its reason]
  P0 --> P1{resolution stored for this ship and version?}
  P1 -->|yes: give-back or move| M[send the stored rules]
  P1 -->|no| P2{ruleSet offered?}
  P2 -->|no| U1[waits: rule set unknown]
  P2 -->|yes or none| P3{floor resolvable?}
  P3 -->|no| U2[waits: floor unavailable]
  P3 -->|yes| P4{any sets? then a trierarch with the harness guarded}
  P4 -->|none fits| U3[waits: no guarded harness]
  P4 -->|fits, or no sets| P5{64 KB or less?}
  P5 -->|no| U4[waits: rule sets too large]
  P5 -->|yes| P6[store the resolution]
  P6 --> M
  M --> C[claim the assignment]
  subgraph Trierarch[trierarch]
    M --> T1{from its plugin ship, valid, not older?}
    T1 -->|no| T2[refused; kept rules unchanged]
    T1 -->|yes| T3[store outside the worktree, then ack]
    C --> T4{rules for this version within 10 minutes?}
    T4 -->|no| G1[give back: guard rules did not arrive]
    T4 -->|yes| T5{harness settings disable hooks?}
    T5 -->|yes| G2[give back: guard disabled by settings]
    T5 -->|no| S[start the session with the guard; report guard sets]
    S -->|restart| T4
  end
  S --> K[tool call] --> H{guard check}
  H -->|error, crash, deadline| X1[refuse: guard failed]
  H -->|writes a protected file| X2[refuse: protected]
  H -->|unknown tool| X3[refuse: unknown tool]
  H -->|cannot be resolved| X4[refuse: unresolvable]
  H -->|write outside the boundary| X5[refuse: outside the boundary]
  H -->|a set refuses| X6[refuse: rule, set, commit]
  H -->|every set lets it| OK[the call runs]
  X1 --> L[refusal to refusals.jsonl; tool error to the session; it goes on]
  X2 --> L
  X3 --> L
  X4 --> L
  X5 --> L
  X6 --> L
  L --> RS[next pass: guard status with count and recent; activity refused]
```
