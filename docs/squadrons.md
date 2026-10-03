# Squadrons: templates, blueprints and the check-in (draft for approval)

Status: draft, for Thomas to approve before the catalogue is built (#86, PR 2). Model and decisions: #79, #86, decision 0017. Aeolus knows nothing of what is described here; only the squadrons package and the aeolus plugin read it.

## Files in git

Ship templates and squadron blueprints are YAML files in git repositories, as Dockerfiles and compose files are. squadrons reads them from the repositories it is configured with; it never edits them.

- **Where:** in each configured repository, `squadrons/templates/*.yaml` and `squadrons/blueprints/*.yaml`. One file is one template or one blueprint, and the file name (without `.yaml`) is its name.
- **Versions come from git.** A file's version number counts the commits that changed it, oldest first: the first commit that adds `tester.yaml` makes `tester@1`, the next commit that changes it `tester@2`. Its ref is that commit. The console shows templates as `tester@4`, blueprints as `v4`, and each version with its short commit (`4f2a91c`).
- **Snapshots:** forming a squadron stores the blueprint version and every template version it uses, as read then. A squadron never changes when the files change later.

## Ship template

A reusable role, like an image: what a ship in this role does, how often it checks in, how it is launched, and the hand-offs it accepts, like the environment variables an image accepts.

```yaml
# squadrons/templates/tester.yaml
description: Runs the end-to-end suite on a branch and reports the result.
type: tester                 # the Aeolus ship type of its members; the template's name when left out
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
| `type` | no | A ship handle; the template's name when left out |
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
    template: github.com/thomashendrickx/squadron-templates#squadrons/templates/planner.yaml@v3
  implementer:
    template: github.com/thomashendrickx/squadron-templates#squadrons/templates/implementer.yaml@v5
    count: 2
  tester:
    template: github.com/thomashendrickx/squadron-templates#squadrons/templates/tester.yaml@4f2a91c
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
| `roles.<role>.template` | yes | `<repository>#<path>@<ref>`: a configured repository, the file in it, and a git ref (tag, branch or commit). A ref that moves, such as a branch, is read when the squadron forms and then kept in its snapshot |
| `handoffs` | no | `<role>.<hand-off>: <role or flagship>`. Every hand-off a template declares must be bound; a binding to a hand-off no template declares is refused |
| `entry` | yes | The role the flagship hands new work to |

## Names

No squadron prefix by default: membership is known by squadrons and shown with SquadronTag, not carried in names.

- **Squadron id:** the blueprint's name plus six random lowercase alphanumerics, `hemma-feature-a1b2c3`, unless the operator gives one when forming. It is a ship handle, so it can name ships.
- **Flagship:** named as the squadron id (`hemma-feature-a1b2c3`), type `flagship`. "Message the squadron" means messaging this ship, and a member finds its flagship from the squadron id in its crew line.
- **Members:** `<role>-<four random lowercase alphanumerics>`, `implementer-k3x9`, so two squadrons formed from one blueprint never ask for the same name. A blueprint may choose prefixed names with `memberNames: prefixed`, which gives `<squadron id>:<role>-<n>` (`hemma-feature-a1b2c3:implementer-1`).

## Check-in

A ship crewed with a squadron id checks in at its flagship before it does anything else, and again after /clear, compact and resume. These messages travel like any other; the content types are reserved by convention between squadrons and the plugin, not by Aeolus.

1. The member sends `application/vnd.aeolus.squadron.check-in+json` to its flagship: `{ "squadron": "<id>" }`. Its ship id is the sender.
2. The flagship answers it (`inReplyTo` set) with `application/vnd.aeolus.squadron.role+json`: `{ "squadron", "role", "template": "tester@4", "charter", "checkIn": "30m", "handoffs": { "on-fail": "implementer", ... }, "flagship" }`. A hand-off to one ship names that ship; to a role with several ships, see the open points.
3. The member answers that (`inReplyTo` set) with `application/vnd.aeolus.squadron.on-station+json`: `{ "squadron", "role" }`. From then on it is on station; the squadron sails when every member is.

Standing down: the flagship sends each member `application/vnd.aeolus.squadron.stand-down+json` (`{ "squadron" }`); the member finishes its open work and acks it as any delivery. Health comes from each member's last report (`report`): late after one check-in interval, silent after three.

## Configuration

squadrons reads its repositories from one file, `SQUADRONS_CONFIG` (default `squadrons.yaml` beside the process):

```yaml
repositories:
  - url: https://github.com/thomashendrickx/squadron-templates.git
    name: github.com/thomashendrickx/squadron-templates   # what blueprints reference; the URL without scheme and .git when left out
    token: SQUADRON_TEMPLATES_TOKEN                        # the environment variable holding a read token, for a private repository
refresh: 5m                                                # how often squadrons fetches; the console also has Refresh
```

## Open points (for Thomas)

1. **A hand-off to a role with several ships** (#79 "next to design"). Proposal: each squadron's members of one role share a ship type of its own, `<squadron id>:<role>`, and a hand-off to that role is a message to "any ship of type `<squadron id>:<role>`", so the first free member takes it. The type, not the name, carries membership. The template's `type` would then only label the role in the console.
2. **Version numbers** from counting commits per file, as above, or from git tags (`tester-v4`)? Counting needs nothing from the author; tags let the author choose when a version exists.
3. **Where the files live**: the fixed `squadrons/` folder, or any path a repository's entry in the config names?
4. **Template for the flagship**: none (the manager crews it), as written here.
