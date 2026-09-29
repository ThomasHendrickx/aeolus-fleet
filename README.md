# aeolus-fleet

Aeolus is an agent fleet manager: a registry of the agent sessions you run (ships) and a message broker between them that never loses a message.

It makes two promises:

1. **Fleet snapshot.** At any moment you see every ship: its name, type, where it runs and whether it is crewed.
2. **Guaranteed communication.** Any ship can reach any other ship or the operator. A send returns OK only once the message is durably stored, and nothing is lost when a session dies.

Aeolus is harness-agnostic (Claude Code, Codex or any agent that speaks the ship contract over MCP or REST) and content-blind: payloads are opaque.

## Status

Pre-v1, design complete, build starting. The v1 acceptance test: two ships exchange messages back and forth.

## Documentation

- [Product and domain blueprint](docs/blueprint.md)
- [Solution and technical architecture](docs/architecture.md)
- [Build plan](docs/build-plan.md)
- [Decision records](docs/decisions/README.md)
- [Design reference](docs/design.md)

## Packages

| Package | Contents |
| --- | --- |
| `@aeolus-fleet/server` | The API (tRPC, plus REST and MCP for ships) and the domain on Postgres |
| `@aeolus-fleet/web` | The operator console (Next.js) |
| `@aeolus-fleet/common` | Shared schemas, prefixed ids and types |

## Development

Requires Node 26 and npm. The integration tests start Postgres in Docker through Testcontainers.

```sh
npm install              # also generates the Prisma client
npm run typecheck
npm run lint
npx playwright install chromium   # once, for the end-to-end tests
npm test                 # unit, integration and end-to-end tests; npm run test:unit needs no Docker
```

The end-to-end tests drive the console in Chromium. To use a Chromium you already have, set `CHROMIUM_EXECUTABLE_PATH` instead of installing one.

To run it locally against any Postgres 16 or newer:

```sh
cp packages/server/.env.example packages/server/.env   # then point DATABASE_URL at your Postgres
npm run db:migrate --workspace @aeolus-fleet/server
npm run fleet:init --workspace @aeolus-fleet/server -- --name "my fleet"   # prints argo's secret once
npm run dev --workspace @aeolus-fleet/server            # API on http://127.0.0.1:4000
npm run dev --workspace @aeolus-fleet/web               # web app on http://localhost:3000, sign in with argo's secret
```

Releases are published only by the Release workflow (`.github/workflows/release.yml`), started by hand with a version. See [ADR 0011](docs/decisions/0011-release-via-trusted-publishing.md).

## Contributing

- Branch from `main` and open a pull request.
- Keep commits focused with descriptive messages.
- Use npm, not pnpm or yarn.

## License

Apache License 2.0, see [LICENSE](LICENSE).
