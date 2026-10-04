# aeolus-fleet

Aeolus is an agent fleet manager. You run many AI agent sessions (Claude Code, Codex, anything that speaks MCP or REST); Aeolus keeps a registry of them, called ships, and carries messages between them and you.

The problem it solves: agent sessions die, get cleared and restart, and a message sent to one in the meantime is easily lost, or lands with no one to read it. Aeolus makes two promises:

1. **Fleet snapshot.** At any moment you see every ship: its name, its type, where it runs, whether a session crews it, and what it last reported.
2. **Guaranteed communication.** Any ship can reach any other ship or the operator. A send returns OK only once the message is stored, and nothing is lost when a session dies: a delivery waits until a session takes it and acknowledges it.

Aeolus distributes work; it does not run it. Payloads are opaque to it.

![The fleet overview: every ship with its type, status, where it runs, when it was last seen and what it last reported](docs/images/console-fleet.png)

## What works today

Version 0.12:

- **The fleet.** Commission ships, hand out their starting prompts, release, re-crew, rename, ping and retire them. Each ship reports working, blocked or idle with a short note.
- **Guaranteed delivery.** Send to one ship by name or to any ship of a type, with replies threaded. Every delivery is stored, then handed to a session again until it is acknowledged; one received again and again without an acknowledgement goes to the operator's Needs attention.
- **The console.** The operator's web app, live over a WebSocket: the fleet overview, each ship's timeline and messages, the operator inbox, Needs attention, and Compose.
- **The Claude Code plugin.** One line crews a ship from a Claude Code session. The session keeps it across `/clear` and restarts, and wakes by itself when a delivery arrives, without spending tokens while it waits.
- **Squadrons (optional).** Form a team of ships from a blueprint in git: roles, how many ships each, and where each hand-off goes. squadrons gives each member its role when it checks in, shows each member's health, adds and removes members, and stands the squadron down when its work is done. A fleet works without it.

| A ship's messages | The operator inbox | A squadron |
| --- | --- | --- |
| ![A ship's page with its messages, threaded by reply](docs/images/console-ship.png) | ![The operator inbox with a message open and a reply box](docs/images/console-inbox.png) | ![A squadron's page: its members by role, each with its health, and its hand-offs](docs/images/console-squadron.png) |

## Run your own fleet

You need Node 26 and Postgres 16 or newer. The packages are on npm.

```sh
npm install @aeolus-fleet/server @aeolus-fleet/web

export DATABASE_URL=postgresql://user:password@localhost:5432/aeolus
export PUBLIC_URL=http://localhost:4000           # where ships reach the fleet
export CONSOLE_ORIGIN=http://localhost:3000       # where the console runs

npx aeolus-server migrate
npx aeolus-server fleet:init --name "my fleet"    # once: asks for the operator email and password
npx aeolus-server start                           # the API on port 4000

AEOLUS_SERVER_URL=http://localhost:4000 npx aeolus-web start   # the console on port 3000
```

Open http://localhost:3000 and sign in with the operator email and password. Every setting, and running behind a proxy or on two hosts, is in the [server](packages/server/README.md) and [web](packages/web/README.md) READMEs.

**Squadrons** run as their own process with their own database. Install `@aeolus-fleet/squadrons`, set `DATABASE_URL` (squadrons' own database) and `FLEET_URL`, and run `npx aeolus-squadrons start`. Then start the console with `AEOLUS_SQUADRONS_URL` set, connect squadrons under Settings, and add the git repositories of your templates and blueprints there. See the [squadrons README](packages/squadrons/README.md).

## Crew a ship from Claude Code

Add the fleet's MCP server once per machine, then install the plugin:

```sh
claude mcp add --transport http --scope user aeolus https://<your fleet>/mcp
```

```
/plugin marketplace add ThomasHendrickx/aeolus-fleet
/plugin install aeolus@aeolus-fleet
```

In the console, Commission ship (or Get starting prompt) shows a crew line per harness. Paste the Claude Code one into a Claude Code session in the folder that should crew the ship:

```
/aeolus:crew <fleetUrl> <shipId> <secret>
```

Cloud sessions and the rest are in the [plugin README](plugins/aeolus/README.md). Any other agent reaches the same calls over MCP at `/mcp` or REST at `/api/v1`, as the [server README](packages/server/README.md#ships) describes.

## Documentation

- [Product and domain blueprint](docs/blueprint.md): ships, crews, leases, deliveries
- [Solution and technical architecture](docs/architecture.md)
- [Squadrons](docs/squadrons.md): templates, blueprints and the check-in
- [Decision records](docs/decisions/README.md)
- [Build plan](docs/build-plan.md)
- [Design system](docs/design/README.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-dark.svg">
  <img alt="Aeolus architecture: clients reach one tRPC router directly or through the MCP and REST adapters; the router calls the core contexts Registry, Messaging and Identity, which use outbound adapters backed by Postgres." src="docs/images/architecture-light.svg" width="680">
</picture>

## Packages

| Package | Contents |
| --- | --- |
| `@aeolus-fleet/server` | The API (tRPC, plus REST and MCP for ships) and the domain on Postgres |
| `@aeolus-fleet/web` | The operator console (Next.js) |
| `@aeolus-fleet/squadrons` | Optional: forms squadrons of ships from blueprints in git and leads them |
| `@aeolus-fleet/common` | Shared schemas, prefixed ids and types |
| `aeolus` ([plugins/aeolus](plugins/aeolus/README.md)) | The Claude Code plugin |

## Development

Requires Node 26 and npm. The integration tests start Postgres in Docker through Testcontainers.

```sh
npm install              # also generates the Prisma clients
npm run typecheck
npm run lint
npx playwright install chromium   # once, for the end-to-end tests
npm test                 # unit, integration and end-to-end tests; npm run test:unit needs no Docker
```

The end-to-end tests drive the console in Chromium. To use a Chromium you already have, set `CHROMIUM_EXECUTABLE_PATH` instead of installing one.

To run it from the repository against any Postgres 16 or newer:

```sh
cp packages/server/.env.example packages/server/.env   # then point DATABASE_URL at your Postgres
npm run db:migrate --workspace @aeolus-fleet/server
npm run fleet:init --workspace @aeolus-fleet/server -- --name "my fleet"
npm run dev --workspace @aeolus-fleet/server            # API on http://127.0.0.1:4000
npm run dev --workspace @aeolus-fleet/web               # console on http://localhost:3000
```

Releases are published only by the Release workflow (`.github/workflows/release.yml`), started by hand with a version. See [ADR 0011](docs/decisions/0011-release-via-trusted-publishing.md).

## Community

Questions, ideas, and fleets you built: [GitHub Discussions](https://github.com/ThomasHendrickx/aeolus-fleet/discussions).

## Contributing

- Branch from `main` and open a pull request.
- Keep commits focused with descriptive messages.
- Use npm, not pnpm or yarn.

## License

Apache License 2.0, see [LICENSE](LICENSE).
