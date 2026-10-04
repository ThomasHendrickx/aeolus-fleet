# Squadrons: templates, blueprints and the check-in

Model and decisions: #79, #86, decision 0017. Aeolus knows nothing of what is described here; only the squadrons package and the aeolus plugin read it.

## Files in git

Ship templates and squadron blueprints are YAML files in GitHub repositories, as Dockerfiles and compose files are. squadrons reads them from the repositories it is configured with, through GitHub's REST API: it never clones a repository, keeps no files on disk, and never edits them. Other hosts get a reader when someone asks for one.

- **Where:** in each configured repository, `templates/*.yaml` and `blueprints/*.yaml` under its folder: `.aeolus/squadrons/` unless the repository's entry in the configuration sets a `path`. One file is one template or one blueprint, and the file name (without `.yaml`) is its name.
- **Versions are git tags.** A template's version `n` is the tag `<name>@<n>` (`tester@4`), a blueprint's likewise (`hemma-feature@4`), each a whole number from 1. The tag's commit holds that version of the file; a tag whose commit has no such file is ignored. The console shows templates as `tester@4`, blueprints as `v4`, and each version with its short commit (`4f2a91c`). A file changed without a new tag is no new version.
- **Snapshots:** forming a squadron stores the blueprint version and every template version it uses, as read then. A squadron never changes when the files change later.

## Ship template

A reusable role, like an image: what a ship in this role does, how often it checks in, how it is launched, and the hand-offs it accepts, like the environment variables an image accepts.

```yaml
# .aeolus/squadrons/templates/tester.yaml
description: Runs the end-to-end suite on a branch and reports the result.
checkIn: 30m                 # how often a member reports; late after 1 interval, silent after 3
model: claude-opus-5-5       # optional: the exact model a member of this role runs
launchNote: |
  Start in the repository's root, on the branch the planner names.
charter: |
  You test the branch you are given...
  When tests fail, send the report to your on-fail hand-off.
  When they pass, send it to on-pass.
handoffs:                    # the hand-offs the charter refers to, by name, with what each carries
  on-fail: The failing tests and their output
  on-pass: The branch and the run that passed
```

| Field | Required | Rule |
| --- | --- | --- |
| `description` | yes | One line, for the template lists |
| `checkIn` | yes | A duration: `<n>m` or `<n>h`, from 1 minute to 24 hours |
| `model` | no | The exact model id a member runs (`claude-opus-5-5`), never an alias: lowercase letters, digits, dots and hyphens, with at least one digit, not ending in `-latest`. Shown with the launch note; a member that states another model at check-in is flagged, not stopped |
| `launchNote` | no | Shown once with each member's crew lines: where to start the session |
| `charter` | yes | The role's instructions, given to the member at check-in, as written. At most 48 KB (UTF-8), so the role message stays within the 64 KB payload limit |
| `handoffs` | no | Hand-off names (handles) with what each carries; a blueprint binds each to a role |

## Squadron blueprint

A compose file: which roles, how many ships each, which template version each runs, and where each hand-off goes.

```yaml
# .aeolus/squadrons/blueprints/hemma-feature.yaml
description: Plans, builds and tests one feature of Hemma.
roles:
  planner:
    template: github.com/thomashendrickx/squadron-templates#planner@3
  implementer:
    template: github.com/thomashendrickx/squadron-templates#implementer@5
    count: 2
  tester:
    template: github.com/thomashendrickx/squadron-templates#tester@4
handoffs:
  tester.on-fail: implementer
  tester.on-pass: flagship
  implementer.done: tester
```

| Field | Required | Rule |
| --- | --- | --- |
| `description` | yes | One line |
| `roles` | yes | Role names (handles) to a template reference and a `count` (1 when left out, at most 20) |
| `roles.<role>.template` | yes | `<repository>#<name>@<n>`: a configured repository, the template's name, and its version, the tag `<name>@<n>` in that repository. Only tags: never a branch or a commit |
| `handoffs` | no | `<role>.<hand-off>: <role or flagship>`. Every hand-off a template declares must be bound; a binding to a hand-off no template declares is refused |

## Names

No squadron prefix by default: membership is known by squadrons and shown with SquadronTag, not carried in names.

- **Squadron id:** the blueprint's name plus six random lowercase alphanumerics, `hemma-feature-a1b2c3`, unless the operator gives one when forming. It is a ship handle, so it can name ships.
- **Flagship:** named as the squadron id (`hemma-feature-a1b2c3`), type `flagship`. "Message the squadron" means messaging this ship, and a member finds its flagship from the squadron id in its crew line.
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

## Lifecycle

The lifecycle of a squadron and its members (states, transitions, stand down, force stand down, adding and removing members, a new crew line, health, and what squadrons does not handle) is described once, in [the squadrons package README](../packages/squadrons/README.md#lifecycle).

## Connection

squadrons starts not connected: no management ship and no secret in its environment or files. The operator connects it in the console, Settings, Connect squadrons (argo only): the web app's server commissions the management ship, named `squadrons` of type `squadrons` with `fleet:read` and `fleet:manage`, and hands its secret to squadrons, server to server. squadrons registers with it as a server, checks that the ship is of the operator's fleet and holds both scopes (otherwise it lets the ship go and keeps nothing), and keeps only the crew token. The secret is never shown or stored.

- **Not connected:** forming and the flagships wait, and the squadrons API answers that squadrons is not connected; `/api/health` and `/api/version` say `not-connected`.
- **Connected:** squadrons crews the ship again with its kept crew token after a restart.
- **Released:** when the operator releases the management ship, squadrons drops the crew token and is not connected. Connect squadrons, the same button, releases the ship if a session still holds it, gives it a new starting prompt and connects again.

## Template repositories

The repositories squadrons reads are runtime configuration: the operator adds them in the console, under Settings, never in a file. Each has:

- **URL:** the repository's https URL on github.com, such as `https://github.com/thomashendrickx/squadron-templates.git`; any other URL is refused. Its name, what blueprints reference, is the URL without the scheme and `.git`: `github.com/thomashendrickx/squadron-templates`.
- **Path:** the folder holding `templates/` and `blueprints/`; `.aeolus/squadrons` when left out.
- **Token:** a read token for a private repository, entered once and never shown again. squadrons reads a repository with its own token only, and with no token unauthenticated: a private repository without a token that can read it is not read, whatever credentials the host holds.

squadrons fetches a repository when the operator adds it, every repository when the operator refreshes, and every repository once when it connects or starts, since it keeps nothing across a restart; never on a timer. A fetch reads the repository's tags and, for each tag `<name>@<n>` it has not read yet at that commit, its files: a tag never changes, so its files are read once. A fetch that fails keeps the repository, with why, and keeps what it last read. Removing a repository takes its versions out of the catalogue at once; formed squadrons keep the versions they formed from.
