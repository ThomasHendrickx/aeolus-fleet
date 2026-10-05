# Decisions

Current state only; history is in git. To change a decision, edit its file and its line here in the same commit. Read this index first; open a file when you need the full rule.

- [0001](0001-ack-on-receipt.md) **Ack on receipt.** Ship acks when it receives. Aeolus owns distribution, not execution.
- [0002](0002-opaque-ship-secret.md) **Ship secrets and scopes.** Opaque hashed secret, one per ship, used only to register. Four scopes stored server-side with the ship, set at commission and never changed; agents send and receive, and may be given fleet:read and fleet:manage.
- [0003](0003-postgres-as-broker.md) **Postgres is the broker.** Commit before OK, `SKIP LOCKED` claims, `NOTIFY` after commit.
- [0004](0004-trpc-single-api.md) **tRPC is the only API door.** REST and MCP map onto the same procedures (ship calls and the fleet actions for ships with fleet scopes), no own logic.
- [0005](0005-prefixed-ids.md) **Prefixed ids.** `<prefix>_<lowercase ULID>`: `flt_ shp_ msg_ dlv_ evt_ lse_ crd_ opr_ ses_`.
- [0006](0006-payload-limit.md) **Payloads max 64 KB.** Carry a reference plus instruction, not content.
- [0007](0007-tenancy.md) **Every record belongs to a fleet.** `fleet_id` everywhere, scoped queries. Only unscoped: secret hash, token hash, operator email lookup, and the installation (0020).
- [0008](0008-packages.md) **Four packages, one repo.** server, web, common, squadrons (optional); one version. Hosting in private infra repo.
- [0009](0009-stack.md) **Stack.** Node 26, Fastify, tRPC, Next.js, Prisma, Zod, Vitest, Testcontainers, Playwright.
- [0010](0010-leases-without-heartbeats.md) **Leases until released.** No heartbeats; second claim fails (except `argo` takeover); release and deregister invalidate the secret; location reported on claim.
- [0011](0011-release-via-trusted-publishing.md) **Release via trusted publishing.** Only `release.yml` publishes, no tokens, no second test run, tags `v<version>`, creates its GitHub Release with notes from the PRs labelled `<version>`, and commits the plugin's version to main.
- [0012](0012-operator-is-a-ship.md) **Operator is the ship `argo`.** Permanent, all scopes, no secret; crewed only by the operator's email and password login; one session at a time; another service checks a console session with `console.session`, from the forwarded cookie.
- [0013](0013-breaking-changes-before-1-0.md) **Breaking changes before 1.0.0.** Allowed; no compatibility layers.
- [0014](0014-strict-test-driven-development.md) **Strict TDD.** Server and common test first, `(red)` commit then green; push green only.
- [0015](0015-ship-identity-per-conversation.md) **Identity per conversation, per folder with the plugin.** `register` returns a crew token; later calls carry it; MCP connection has no ship credential; the plugin keeps the token per working folder.
- [0016](0016-no-policy.md) **No policy.** Scopes are enforced exactly; Aeolus adds no protective rules. Risk is the operator's call.
- [0017](0017-squadrons-package.md) **Squadrons, a ship of the fleet.** Separate package, own process and database, reaches the fleet only through the public API as its management ship (fleet:read, fleet:manage); Aeolus knows nothing about squadrons.
- [0018](0018-model-and-harness.md) **Model and harness.** Every send states the session's exact model (required for every ship but argo); the harness is free text with known values, stated when a session crews a ship and read with its location; squadrons states its package and version.
- [0019](0019-starting-prompt-presentation.md) **Starting prompt presentation.** Core issues the secret only; the tRPC adapter answers the prompt, one crew line per harness (Claude Code, Codex) and the secret; clients read `secret`, never parse a line.
- [0020](0020-installation.md) **Installation.** One server hosts many fleets for a hosting service; installation procedures on the tRPC router behind an installation token (off without one); request ids on create and delete; hosted operators have no password and sign in with a one-time ticket; limits are configuration (defaults, per-fleet override, fleet cap; unset is none); delete removes every record of the fleet, events included, and keeps only a request hash.
- [0021](0021-squadrons-installation.md) **Squadrons serve many fleets, switched per fleet.** One install, one connection per fleet; a hosting service switches squadrons on or off per fleet with squadrons' own installation token (open and every fleet served without one); off does nothing and keeps everything; delete forgets the fleet in squadrons only.
- [0022](0022-viewer-ship.md) **Viewer ship.** A fleet created with a viewer gets the permanent ship `viewer` (`fleet:read` only, receives nothing); viewer tickets start viewer sessions, many at once and holding no lease, 2 hours after last use and 24 at most; `console.session` answers the kind and scopes.
- [0023](0023-notices.md) **Notices.** The installation sets the console's notices (text, links, dismissible, audience `everyone`, `operators` or `viewers`), replacing the list; each console session shows those of its audience above every page and dismisses a dismissible one for itself; a link may sign out first.
