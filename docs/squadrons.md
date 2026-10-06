# Squadrons: templates, blueprints and the check-in

Model and decisions: #79, #86, decision 0017. Aeolus knows nothing of what is described here; only the squadrons package and the aeolus plugin read it.

## Files in git

Ship templates and squadron blueprints are YAML files in GitHub repositories, as Dockerfiles and compose files are. squadrons reads them from the repositories it is configured with, through GitHub's REST API: it never clones a repository, keeps no files on disk, and never edits them. Other hosts get a reader when someone asks for one. To write your first ones, start at [Writing them](#writing-them).

- **Where:** in each configured repository, `templates/*.yaml` and `blueprints/*.yaml` under its folder: `.aeolus/squadrons/` unless the repository's entry in the configuration sets a `path`. One file is one template or one blueprint, and the file name (without `.yaml`) is its name, unless a blueprint sets its own with `name`.
- **Versions are git tags.** A template's version `n` is the tag `<name>@<n>` (`tester@4`), a blueprint's likewise (`hemma-feature@4`), each a whole number from 1. A tag always names the file: a blueprint `team.yaml` that sets `name: hemma-feature` is tagged `team@4`, and each version takes the name its own file sets. The tag's commit holds that version of the file. A tag of that form whose commit has no such file, or whose name is not lowercase (`Tester@4`), is reported with why; any other tag (`v1.0.0`) is no version tag and is ignored. The console shows templates as `tester@4`, blueprints as `v4`, and each version with its short commit (`4f2a91c`). A file changed without a new tag is no new version.
- **Snapshots:** forming a squadron stores the blueprint version and every template version it uses, as read then. A squadron never changes when the files change later.

## Ship template

A reusable role, like an image: what a ship in this role does, how often it checks in, how it is launched, and the hand-offs it accepts, like the environment variables an image accepts.

An example: [tester.yaml](squadrons-example/.aeolus/squadrons/templates/tester.yaml), and its siblings in the [example set](#example-set).

| Field | Required | Rule |
| --- | --- | --- |
| `description` | yes | One line, for the template lists |
| `checkIn` | yes | How often a member reports, late after one interval and silent after three. A duration: `<n>m` or `<n>h`, from 1 minute to 24 hours |
| `model` | no | The exact model id a member runs (`claude-opus-5-5`), never an alias: lowercase letters, digits, dots and hyphens, with at least one digit, not ending in `-latest`. Shown with the launch note; a member that states another model at check-in is flagged, not stopped |
| `launchNote` | no | Shown once with each member's crew lines: where to start the session |
| `charter` | yes | The role's instructions, given to the member at check-in, as written. At most 48 KB (UTF-8), so the role message stays within the 64 KB payload limit |
| `handoffs` | no | Hand-off names (handles) with what each carries; a blueprint binds each to a role |

## Squadron blueprint

A compose file: which roles, how many ships each, which template version each runs, and where each hand-off goes.

An example: [tidewater-feature.yaml](squadrons-example/.aeolus/squadrons/blueprints/tidewater-feature.yaml), and [tidewater-fix.yaml](squadrons-example/.aeolus/squadrons/blueprints/tidewater-fix.yaml) with prefixed member names.

| Field | Required | Rule |
| --- | --- | --- |
| `name` | no | The blueprint's name, a handle: in the catalogue, the console, a form reference and the base of squadron ids. The file name when left out. Its tag stays `<file name>@<n>`. Blueprint files of one repository that give one name (a `name`, or a file name another sets as its `name`) are all left out, each saying which others give it |
| `description` | yes | One line |
| `roles` | yes | Role names (handles) to a template reference and a `count` (1 when left out, at most 20) |
| `roles.<role>.template` | yes | `<repository>#<name>@<n>`: a configured repository, the template's name, and its version, the tag `<name>@<n>` in that repository. Only tags: never a branch or a commit |
| `handoffs` | no | `<role>.<hand-off>: <role or flagship>`. Every hand-off a template declares must be bound; a binding to a hand-off no template declares is refused |
| `memberNames` | no | `plain` (when left out) or `prefixed`; see [Names](#names) |

## Writing them

### Example set

[docs/squadrons-example](squadrons-example) is a complete set for an invented project, Tidewater: four templates (planner, implementer, reviewer, tester) and two blueprints (`tidewater-feature`, `tidewater-fix`) in a repository named `github.com/tidewater-labs/squadron-templates`. Each file is version 1, as its tag `<name>@1` would make it. A test reads the set through squadrons' own reader and leaves nothing out, so it stays valid.

### Step by step

1. Write the template in `.aeolus/squadrons/templates/<name>.yaml`, with the fields of [Ship template](#ship-template). The name is a handle: lowercase letters, digits, hyphens or colons.
2. Commit it, tag that commit `<name>@1`, and push the tag: `git tag tester@1 && git push origin tester@1`. The next version is a new commit tagged `tester@2`; never move a tag.
3. Write the blueprint in `.aeolus/squadrons/blueprints/<name>.yaml`, with the fields of [Squadron blueprint](#squadron-blueprint); set `name` when it should go by another name than its file's. Each role names its template as `<repository>#<template>@<n>`, where the repository is the name squadrons gives it under [Template repositories](#template-repositories) and `<n>` a version tagged in step 2. Bind every hand-off the templates declare.
4. Commit it, tag that commit `<file name>@1` and push the tag. The blueprint's tag and its templates' tags may point at different commits: each file is read at its own tag.
5. In the console, Settings, Repositories: add the repository, or Refresh when it is added already. squadrons never fetches on a timer. The repository's row shows what was found, and each file or tag left out with why.

### Common mistakes

- **A change without a tag.** Editing a file on main changes nothing: only a new tag is a new version.
- **A tag that does not match the file.** The tag `tester@1` reads `templates/tester.yaml` and `blueprints/tester.yaml` at its commit, nothing else. `Tester@1`, `tester-1`, `tester@v1` and `tester@1.0` are no versions, and a file named `Tester.yaml` or `tester.yml` is not read.
- **Letter case in a reference.** A reference's repository must be the repository's name exactly, letter case too: a repository added as `https://github.com/Tidewater-Labs/squadron-templates` is named `github.com/Tidewater-Labs/squadron-templates`, and a reference to `github.com/tidewater-labs/squadron-templates` does not find it.
- **A reference to a version that is not tagged**, or to a branch or a commit: a role's template is always `<name>@<n>`, a tag that exists.
- **A hand-off left unbound**, or bound to a role the blueprint does not have. A blueprint binds exactly the hand-offs its templates declare, each to one of its roles or to `flagship`.
- **A duration or model in another form.** `checkIn` is `30m` or `2h`, not `30 min`, `90s` or `2d`. `model` is an exact id such as `claude-opus-5-5`, never `opus` or `claude-opus-latest`.
- **Two blueprints of one name.** Two blueprint files of one repository that give one name, through `name` or their file name, are both left out: give each its own name.
- **A template and a blueprint of one name.** One tag reads both folders, so `tester@1` would be both a template and a blueprint version; give them different names.

## Names

No squadron prefix by default: membership is known by squadrons and shown with SquadronTag, not carried in names.

- **Squadron id:** the blueprint's name plus six random lowercase alphanumerics, `hemma-feature-a1b2c3`, unless the operator gives one when forming. It is a ship handle, so it can name ships.
- **Flagship:** named as the squadron id (`hemma-feature-a1b2c3`), type `flagship`. "Message the squadron" means messaging this ship, and a member finds its flagship from the squadron id in its crew line. The squadron page offers Message, to the flagship, until the squadron is Disbanded (Forming, Sailing and Standing down), to a session that may send: Aeolus blocks no message. A member's menu on that page offers no Release: Get new crew line is how a member gets a new session. While the squadron is Standing down, and once it is Disbanded, the page says what that state means, with no time: the squadrons API records none for either. The page of a ship in a squadron, its flagship or a member, sits below it: the breadcrumb reads Squadrons, the squadron, the ship, and each level above links up to it.
- **Members:** `<role>-<four random lowercase alphanumerics>`, `implementer-k3x9`, so two squadrons formed from one blueprint never ask for the same name. A blueprint may choose prefixed names with `memberNames: prefixed`, which gives `<squadron id>:<role>-<n>` (`hemma-feature-a1b2c3:implementer-1`).
- **Member types:** every member of one role in one squadron has the ship type `<squadron id>:<role>` (`hemma-feature-a1b2c3:implementer`). A hand-off to a role is a message to any ship of that type, so the first free member of the role takes it, and no other squadron's ship ever does. The type carries the membership until Aeolus has labels; names carry none.
- **The flagship has no template:** squadrons crews it itself.
- **What squadrons' ships state:** its management ship and every flagship state `@aeolus-fleet/squadrons@<version>`, the version it runs, as their model on every send, and `aeolus-squadrons` as their harness (decision 0018).

## Check-in

A ship crewed with a squadron id checks in at its flagship before it does anything else, and again after /clear, compact and resume. These messages travel like any other; the content types are reserved by convention between squadrons and the plugin, not by Aeolus.

1. The member sends `application/vnd.aeolus.squadron.check-in+json` to its flagship: `{ "squadron": "<id>", "model": "<the exact model id it runs>" }`. Its ship id is the sender. squadrons keeps the model it states; when its template pins a model and the member states another, or none, the member shows a model mismatch. Nothing is refused for it.
2. The flagship answers it (`inReplyTo` set) with `application/vnd.aeolus.squadron.role+json`: `{ "squadron", "role", "template": "tester@4", "charter", "checkIn": "30m", "handoffs": { "on-fail": { "kind": "type", "type": "hemma-feature-a1b2c3:implementer" }, "on-pass": { "kind": "ship", "name": "hemma-feature-a1b2c3" } }, "flagship" }`. Each hand-off is the selector to send to: the role's type, or the flagship by name. While the squadron stands down, the role message also holds `"standingDown": true`; what the member does then is in [Stand down](../packages/squadrons/README.md#stand-down).
3. The member answers that (`inReplyTo` set) with `application/vnd.aeolus.squadron.on-station+json`: `{ "squadron", "role" }`. From then on it is on station; a Forming squadron sails when every member is.

The other two messages of this convention, `application/vnd.aeolus.squadron.stand-down+json` from the flagship and `application/vnd.aeolus.squadron.stood-down+json` from the member, are described once, in [Stand down](../packages/squadrons/README.md#stand-down).

A ship's Messages tab in the console says each of these five in words, by its content type: "Checked in at its flagship", "Given the role: reviewer", "Took up the role: reviewer", "Asked to stand down", "Stood down". The message sheet keeps the payload, formatted and raw. Any other JSON payload shows there as its top-level fields in one compact line. The server knows none of these types.

## Lifecycle

The lifecycle of a squadron and its members (states, transitions, stand down, force stand down, adding and removing members, a new crew line, health, and what squadrons does not handle) is described once, in [the squadrons package README](../packages/squadrons/README.md#lifecycle).

## Connection

One squadrons install serves every fleet at its `FLEET_URL`, with one connection per fleet (decision 0021): each fleet's operator connects it for their own fleet, and works on that fleet only. squadrons starts not connected to a fleet: no management ship and no secret in its environment or files. The operator connects it in the console, Settings, Connect squadrons (argo only): the web app's server commissions the management ship, named `squadrons` of type `squadrons` with `fleet:read` and `fleet:manage`, and hands its secret to squadrons, server to server. squadrons registers with it as a server, checks that the ship is of the operator's fleet and holds both scopes (otherwise it lets the ship go and keeps nothing), and keeps only the crew token. The secret is never shown or stored.

- **Not connected:** that fleet's forming and flagships wait, and the squadrons API answers its operator that squadrons is not connected; `/api/health` and `/api/version` count the fleets squadrons is connected to.
- **Connected:** squadrons crews each fleet's ship again with its kept crew token after a restart.
- **Released:** when the operator releases the management ship, squadrons drops that fleet's crew token and is not connected to it; other fleets stay connected. Connect squadrons, the same button, releases the ship if a session still holds it, gives it a new starting prompt and connects again.

## Switched per fleet

A hosting service can switch squadrons on or off per fleet (decision 0021). With no installation token configured the installation is open: every fleet is served, and nothing below applies.

- **Off until switched on:** with an installation token, a fleet is off until the hosting service switches it on.
- **Off:** squadrons does nothing for the fleet. Its console shows nothing of squadrons; the squadrons API answers only `connection.status` (with `enabled: false`) and refuses the rest, Connect included; its flagships stop receiving and its stand-downs wait. Everything is kept: on again, it resumes as it was.
- **Delete:** squadrons forgets everything it holds of the fleet: its repositories and their tokens, its catalogue, its squadrons and what their flagships kept, its formation attempts, its connection and its switch. The fleet is told nothing; its ships stay there.

## Template repositories

The repositories squadrons reads are runtime configuration: the operator adds them in the console, under Settings, never in a file. Each has:

- **URL:** the repository's https URL on github.com, such as `https://github.com/thomashendrickx/squadron-templates.git`; any other URL is refused. Its name, what blueprints reference, is the URL without the scheme and `.git`: `github.com/thomashendrickx/squadron-templates`.
- **Path:** the folder holding `templates/` and `blueprints/`; `.aeolus/squadrons` when left out.
- **Token:** a read token for a private repository, entered once and never shown again. squadrons reads a repository with its own token only, and with no token unauthenticated: a private repository without a token that can read it is not read, whatever credentials the host holds.

squadrons fetches a repository when the operator adds it, every repository when the operator refreshes, and every repository once when it connects or starts, since it keeps nothing across a restart; never on a timer. A fetch asks GitHub for the repository's tags, naming the ETag of its last answer: an unchanged repository answers 304, which GitHub does not count against its rate limit, and nothing more is read. A commit's content never changes, so what is read at one is kept by repository and commit, for every fleet of the install: a new commit costs one tree and one commit call, and one read for each file of a tag `<name>@<n>` that exists there. Each fleet still asks for the tags itself, with its own token, before it is given anything kept. A fetch that fails keeps the repository, with why, and keeps what it last read. Settings shows for each repository the template and blueprint versions found, and every version and version tag left out with its reason: invalid YAML, a missing or wrong field (which, and what it expects), a reference to a repository squadrons does not know (or knows under another letter case: names match exactly), to a template at no tag or a version not tagged, an unbound or unknown hand-off, a tag with no file of its name. A repository read whole shows nothing left out. Removing a repository takes its versions out of the catalogue at once; formed squadrons keep the versions they formed from.
