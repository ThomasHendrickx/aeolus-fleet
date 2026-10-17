# Packaging, licensing and releases

Design study by designer-4. Read only: it decides nothing. It takes up Thomas's question of 17 Oct and asks him to choose.

> "I do want to critically look at our plugins being part of aeolus fleet and always same version. We are going to B2B type stuff and don't know if everything all the time needs to be open source and I am noticing that synced versions is making releasing a bit awkward."

## Purpose

Aeolus is going B2B, with one organisation per fleet. Three things should be free to differ per part, where today they cannot:

- **Licence.** What a customer may run, change and sell. Today every part is Apache-2.0.
- **Version.** A fix to one part should not republish the others. Today all parts share one version.
- **Repository.** Who can see and contribute to the source. Today everything is in one public repo.

The parts in play:

| Part | What it is | Where it runs |
| --- | --- | --- |
| `@aeolus-fleet/core` and the ship contract | The fleet server: `/trpc`, `/api/v1`, `/mcp` | The fleet's server |
| `@aeolus-fleet/common` | Schemas, ids, rules | Every package's build |
| `@aeolus-fleet/console` | argo's admin console (scope-rework question 28) | Beside core |
| `@aeolus-fleet/squadrons`, `trierarch-plugin`, `networking-plugin` | Plugins on the server side, each a ship with its own database (0017, 0030, 0036) | Beside core |
| `@aeolus-fleet/trierarch` and the session image | The launcher on each machine (0026, 0039) | A customer's machines |
| The `aeolus` plugin for Claude Code and Codex (`plugins/aeolus`) | Crews a ship from a session | A customer's harness |
| The planned A2A gateway (docs/design/interop-a2a, branch design/interop-a2a) | Speaks A2A and MCP on behalf of ships | Beside core |
| `aeolus-fleet-infra` (private) and pagasae | Thomas's hosting, and the hosted service's account and installation side (0020) | Thomas's servers |

## Lessons to check against

- **0008: seven packages, one repo, one version.** Its "Why" says "one version while the packages move together". It rejected separate repos per package. architecture.md says the same: "The packages stay in one repo while they share one version". So both decisions were made conditional on the packages moving together.
- **0011: trusted publishing, one version.** Every release does the same steps:
  - publishes all seven packages, in order;
  - builds and pushes the session image;
  - tags `v<version>` on a commit that sets the aeolus plugin's manifests;
  - creates the GitHub Release from labelled PRs;
  - on main, commits the plugin's version to main.

  A new package needs a hand-published 0.0.0 before its trusted publisher can be set.
- **0013: before 1.0.0, breaking changes are allowed, with no compatibility layers.** Independent versions only pay off with a stated contract between core and plugins, and that contract is a compatibility promise.
- **CLAUDE.md:** no paid-product polish for zero customers.
- **The plugins already talk to core only through its public API.** squadrons, the trierarch plugin, the networking plugin and the trierarch use `/api/v1` with a crew token. Their only build-time tie to core is `@aeolus-fleet/common` (package.json dependencies). Plugin details' shapes per ship type (0028) and crew settings schemas (0027) live in common, so common is the shared contract today.
- **The console builds against core's router types.** It lists `@aeolus-fleet/core` and `@aeolus-fleet/common` as dev dependencies, so the console and core are one unit at build time.
- **Who holds the copyright.** Every commit on main is Thomas's or one made under his name (2019 by Thomas, 530 by Claude, plus bots). There is no CLA and CONTRIBUTING.md states no licence terms. So nothing outside contributors wrote limits a licence change of new code. This is a fact, not legal advice.
- **Apache-2.0 cannot be taken back for versions already published.** Any change applies to new versions only. A lawyer confirms the details.

### How releases went (gh release list, git diff between tags)

There were 17 releases from v0.20.0 (8 Oct) to v0.26.1 (16 Oct): two a day. Each one did all of the following:

- republished seven packages;
- rebuilt and pushed the session image;
- moved the aeolus plugin's version. Both harnesses cache the plugin by version, so every plugin user and every trierarch machine sees an update.

Real cases:

| Release | What changed (excluding the plugin manifests) | What was published |
| --- | --- | --- |
| v0.26.1 | `packages/console`, 10 files: one fix (#871) | All seven packages, the session image, the plugin version, and a commit to main |
| v0.25.2 | `packages/console` (15 files), `packages/core` (1 file) | The same |
| v0.24.1 | `packages/console`, 5 files: an overview cleanup (#781) | The same. It also needed `hotfix/0.24.x`, a cherry-pick (#783) and a new release rule (#782, now in 0011), because main already held 0.25 work for other packages |
| v0.25.3 | Ten fixes across plugin, trierarch, core and console | All seven. Here one version fits: the parts moved together |

What the synced version costs:

1. **Noise.** A console fix means `aeolus-trierarch upgrade` on every machine and a plugin update in every harness, for code that did not change.
2. **Hotfixes take a branch.** Fixing one part while main holds newer work in another needs a hotfix branch and a cherry-pick (v0.24.1).
3. **One gate.** One CI result gates everything, so a red test in one package blocks releasing any other.
4. **No mixed licences.** It ties every part to the same licence and repo, since one workflow publishes from one tree.

What it saves:

1. **One number.** Asking which version someone runs has one answer.
2. **No compatibility matrix.** Nobody has to test which plugin version works with which core.
3. **Pinned plugin.** `aeolus-trierarch upgrade <version>` installs the plugin of the same tag (0011). That matters while the protocol between the plugin, the trierarch and core moves weekly (0040, 0.8 contained calls).

## Questions for Thomas

### 1. What stays open source?

The field's common models, one line each:

- **Fully open source.** Everything under a permissive licence (Apache-2.0, as now); revenue comes from hosting and support.
- **Open core.** The core is open source, and named extra parts are under a commercial licence (GitLab, Mattermost).
- **Copyleft core with a commercial licence beside it.** The core is under AGPL, so anyone hosting a changed core must publish their changes; companies buy a commercial licence instead (Grafana for AGPL).
- **Source-available licences.** Readable source with limits on use, commonly on offering it as a competing hosted service:
  - Business Source License: each version becomes open source after a set date (HashiCorp, earlier Sentry).
  - Functional Source License: becomes Apache or MIT after two years (Sentry now).
  - Elastic License 2.0.
- **Hosted-only parts.** Some parts are never published at all and run only in the hosted service, such as pagasae's account and billing side today.

What an open-core split means:

- **For customers.** A self-hosted organisation runs open core free. It pays, or uses the hosted service, for the closed parts. The ship contract stays open, so any harness or app can be a ship.
- **For contributors.** A contribution to an open part may end up in a commercial product, which usually needs a CLA or a DCO before outside contributions are taken. A closed part takes none.

Where each part could sit:

| Part | Stays open? | Why |
| --- | --- | --- |
| core, common, the ship contract | Open | It is the standard every ship and app talks to. A closed ship contract kills "any harness can crew a ship" and the A2A reach |
| aeolus plugin, trierarch | Open | They run on customers' machines and hold their crew. Customers read what runs there |
| console (argo's admin) | Open, with core | It builds against core's router types and is how a self-hosted fleet is run |
| squadrons, trierarch plugin, networking plugin | Either | Optional, own process, own database, public API only. The natural line for open core |
| A2A gateway | Either | Optional, and the B2B selling point. Under the interop study it would hold outside credentials, which customers may want to read |
| pagasae, aeolus-fleet-infra | Closed (as now) | They are the hosted service, not the product |

Options:

- (a) Keep everything Apache-2.0, and sell hosting and support.
- (b) Open core: core, common, console, plugin and trierarch stay Apache-2.0. Named plugins and the gateway, from a version on, go under a commercial or source-available licence.
- (c) Make the whole product source-available (Functional Source License or Business Source License) from a version on.
- (d) Some features are hosted-only: closed parts that run only in pagasae.

Pick: none. Which licence fits a B2B sale is Thomas's call and a lawyer's. Whichever he picks, the ship contract and what runs on customers' machines stay open, and the line runs between core and the optional plugins. That line already exists in code: separate packages, a separate process, and the public API only.

### 2. One version, or one per package?

Options:

- (a) **One version for all**, as today.
- (b) **Independent versions per package**, each released by its own workflow run. A stated compatibility contract sits between core and each plugin:
  - **The ship contract version.** `/api/v1`, and `SERVER_INFO.version` `'1'` in `mcp-endpoint.ts`, already carry a number.
  - **What a plugin needs from core.** The REST calls it makes, the scopes, and the fleet actions.
  - **The rule.** A plugin states the minimum core version it needs. Core says its version and ship contract version in `whoami` or `/health`. A plugin refuses to start against an older core and says why.
  - **common.** It becomes a versioned package of its own, the contract the others build against.
- (c) **Two release trains.** Core with common and console is one version. The plugin and trierarch, which change together (0.8, 0040), are another. squadrons, the trierarch plugin, the networking plugin and the gateway each get their own. Contract as in (b).

Pick: (c). It ends the noise of v0.26.1 and v0.24.1, where a console fix moved every machine. It keeps pinned the pairs that really move together: core with console, and the plugin with the trierarch. It is the precondition for licensing parts apart in question 1. The contract is a minimum version check, not a compatibility layer, so it stays within 0013. Its cost:

- release.yml split per train;
- release-gate and release-notes per package (labels as `<package>@<version>`);
- `aeolus-trierarch upgrade` resolving the plugin by its own train's tag, not core's;
- the version check in each plugin;
- a short compatibility table in the docs.

### 3. One repo, or several?

Options:

- (a) **One public monorepo**, as today.
- (b) **Core repo plus private repos**. The public repo keeps core, common, console, the aeolus plugin and the trierarch. Each closed part moves to a private repo, consuming `@aeolus-fleet/common` from npm.
- (c) **A private monorepo for all closed parts**, beside the public one.

Pick: (a) until question 1 closes any part, then (c). A repo split only earns its cost once a part's source is not open. Before that, independent versions (question 2) work inside one monorepo with per-package workflows. When a part closes, one private repo for all closed parts keeps one CI and one dependency update flow. It stops common's changes spreading over several repos, and fits a team of one. It also needs its own trusted publisher, or a private registry, for the closed packages.

What would move under (c):
- the closed plugins' packages, their docs, their decisions (0017, 0021, 0030, 0036), and their workflows;

The blueprint and decisions index in the public repo then point to them by name only.

### 4. The order, without blocking the scope rework or interop

1. **Now, docs only.** Write the compatibility contract down: the ship contract version, and each plugin's calls and scopes, from what the plugins call today. This blocks nothing and is needed whatever is picked.
2. **After the scope rework's catalogue lands.** Scopes are the largest part of what a plugin needs from core, so the contract is stated after them, not before. Then build the version check (core states its versions; each plugin checks the minimum) and split release.yml into trains (question 2). Through that release, the one version stays as today.
3. **The gateway** (interop level 3) starts as its own package on its own train from its first release. Being new, it needs no move.
4. **Only if Thomas closes a part** (question 1): choose its licence from a version on, create the private repo, move the package with its history, and publish it from there. Core and the open parts do not change.
5. **Before outside contributors arrive:** a CLA or DCO, if any open part feeds a commercial one.

Steps 1 and 3 can run beside the scope rework and the interop work. Step 2 waits for the scope catalogue only for its contract text, not its code.
