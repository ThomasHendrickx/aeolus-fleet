# Squadrons: templates, blueprints and the check-in

Model and decisions: #79, #86, decision 0017. Aeolus knows nothing of what is described here; only the squadrons package and the aeolus plugin read it.

## Files in git

Ship templates and squadron blueprints are YAML files in git repositories, as Dockerfiles and compose files are. squadrons reads them from the repositories it is configured with; it never edits them.

- **Where:** in each configured repository, `templates/*.yaml` and `blueprints/*.yaml` under its folder: `squadrons/` unless the repository's entry in the configuration sets a `path`. One file is one template or one blueprint, and the file name (without `.yaml`) is its name.
- **Versions are git tags.** A template's version `n` is the tag `<name>@<n>` (`tester@4`), a blueprint's likewise (`hemma-feature@4`), each a whole number from 1. The tag's commit holds that version of the file; a tag whose commit has no such file is ignored. The console shows templates as `tester@4`, blueprints as `v4`, and each version with its short commit (`4f2a91c`). A file changed without a new tag is no new version.
- **Snapshots:** forming a squadron stores the blueprint version and every template version it uses, as read then. A squadron never changes when the files change later.

## Ship template

A reusable role, like an image: what a ship in this role does, how often it checks in, how it is launched, and the hand-offs it accepts, like the environment variables an image accepts.

```yaml
# squadrons/templates/tester.yaml
description: Runs the end-to-end suite on a branch and reports the result.
checkIn: 30m                 # how often a member reports; late after 1 interval, silent after 3
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
| `launchNote` | no | Shown once with each member's crew line: where to start the session |
| `charter` | yes | The role's instructions, given to the member at check-in, as written |
| `handoffs` | no | Hand-off names (handles) with what each carries; a blueprint binds each to a role |

## Squadron blueprint

A compose file: which roles, how many ships each, which template version each runs, and where each hand-off goes.

```yaml
# squadrons/blueprints/hemma-feature.yaml
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
entry: planner
```

| Field | Required | Rule |
| --- | --- | --- |
| `description` | yes | One line |
| `roles` | yes | Role names (handles) to a template reference and a `count` (1 when left out, at most 20) |
| `roles.<role>.template` | yes | `<repository>#<name>@<n>`: a configured repository, the template's name, and its version, the tag `<name>@<n>` in that repository. Only tags: never a branch or a commit |
| `handoffs` | no | `<role>.<hand-off>: <role or flagship>`. Every hand-off a template declares must be bound; a binding to a hand-off no template declares is refused |
| `entry` | yes | The role the flagship hands new work to |

## Names

No squadron prefix by default: membership is known by squadrons and shown with SquadronTag, not carried in names.

- **Squadron id:** the blueprint's name plus six random lowercase alphanumerics, `hemma-feature-a1b2c3`, unless the operator gives one when forming. It is a ship handle, so it can name ships.
- **Flagship:** named as the squadron id (`hemma-feature-a1b2c3`), type `flagship`. "Message the squadron" means messaging this ship, and a member finds its flagship from the squadron id in its crew line.
- **Members:** `<role>-<four random lowercase alphanumerics>`, `implementer-k3x9`, so two squadrons formed from one blueprint never ask for the same name. A blueprint may choose prefixed names with `memberNames: prefixed`, which gives `<squadron id>:<role>-<n>` (`hemma-feature-a1b2c3:implementer-1`).
- **Member types:** every member of one role in one squadron has the ship type `<squadron id>:<role>` (`hemma-feature-a1b2c3:implementer`). A hand-off to a role is a message to any ship of that type, so the first free member of the role takes it, and no other squadron's ship ever does. The type carries the membership until Aeolus has labels; names carry none.
- **The flagship has no template:** squadrons crews it itself.

## Check-in

A ship crewed with a squadron id checks in at its flagship before it does anything else, and again after /clear, compact and resume. These messages travel like any other; the content types are reserved by convention between squadrons and the plugin, not by Aeolus.

1. The member sends `application/vnd.aeolus.squadron.check-in+json` to its flagship: `{ "squadron": "<id>" }`. Its ship id is the sender.
2. The flagship answers it (`inReplyTo` set) with `application/vnd.aeolus.squadron.role+json`: `{ "squadron", "role", "template": "tester@4", "charter", "checkIn": "30m", "handoffs": { "on-fail": { "kind": "type", "type": "hemma-feature-a1b2c3:implementer" }, "on-pass": { "kind": "ship", "name": "hemma-feature-a1b2c3" } }, "flagship" }`. Each hand-off is the selector to send to: the role's type, or the flagship by name.
3. The member answers that (`inReplyTo` set) with `application/vnd.aeolus.squadron.on-station+json`: `{ "squadron", "role" }`. From then on it is on station; the squadron sails when every member is.

Standing down: the flagship sends each member `application/vnd.aeolus.squadron.stand-down+json` (`{ "squadron" }`); the member finishes its open work and acks it as any delivery. Health comes from each member's last report (`report`): late after one check-in interval, silent after three.

## Configuration

squadrons reads its repositories from one file, `SQUADRONS_CONFIG` (default `squadrons.yaml` beside the process):

```yaml
repositories:
  - url: https://github.com/thomashendrickx/squadron-templates.git
    name: github.com/thomashendrickx/squadron-templates   # what blueprints reference; the URL without scheme and .git when left out
    path: squadrons                                        # the folder holding templates/ and blueprints/; squadrons when left out
    token: SQUADRON_TEMPLATES_TOKEN                        # the environment variable holding a read token, for a private repository
refresh: 5m                                                # how often squadrons fetches; the console also has Refresh
```
