# Decisions

Current state only; history is in git. To change a decision, edit its file and its line here in the same commit. Read this index first; open a file when you need the full rule.

- [0001](0001-ack-on-receipt.md) **Ack on receipt.** Ship acks when it receives. Aeolus owns distribution, not execution.
- [0002](0002-opaque-ship-secret.md) **Ship secrets and scopes.** Opaque hashed secret, one per ship, used only to register. Four scopes stored server-side with the ship.
- [0003](0003-postgres-as-broker.md) **Postgres is the broker.** Commit before OK, `SKIP LOCKED` claims, `NOTIFY` after commit.
- [0004](0004-trpc-single-api.md) **tRPC is the only API door.** REST and MCP map onto the same procedures, no own logic.
- [0005](0005-prefixed-ids.md) **Prefixed ids.** `<prefix>_<lowercase ULID>`: `flt_ shp_ msg_ dlv_ evt_ lse_ crd_ opr_ ses_`.
- [0006](0006-payload-limit.md) **Payloads max 64 KB.** Carry a reference plus instruction, not content.
- [0007](0007-tenancy.md) **Every record belongs to a fleet.** `fleet_id` everywhere, scoped queries. Only unscoped: secret hash, token hash, operator email lookup.
- [0008](0008-packages.md) **Three packages, one repo.** server, web, common; one version. Hosting in private infra repo.
- [0009](0009-stack.md) **Stack.** Node 26, Fastify, tRPC, Next.js, Prisma, Zod, Vitest, Testcontainers, Playwright.
- [0010](0010-leases-without-heartbeats.md) **Leases until released.** No heartbeats; second claim fails (except `argo` takeover); release and deregister invalidate the secret; location reported on claim.
- [0011](0011-release-via-trusted-publishing.md) **Release via trusted publishing.** Only `release.yml` publishes, no tokens, tags `v<version>`.
- [0012](0012-operator-is-a-ship.md) **Operator is the ship `argo`.** Permanent, all scopes, no secret; crewed only by the operator's email and password login; one session at a time.
- [0013](0013-breaking-changes-before-1-0.md) **Breaking changes before 1.0.0.** Allowed; no compatibility layers.
- [0014](0014-strict-test-driven-development.md) **Strict TDD.** Server and common test first, `(red)` commit then green; push green only.
- [0015](0015-ship-identity-per-conversation.md) **Identity per conversation.** `register` returns a crew token; later calls carry it; MCP connection has no ship credential.
- [0016](0016-no-policy.md) **No policy.** Scopes are enforced exactly; Aeolus adds no protective rules. Risk is the operator's call.
