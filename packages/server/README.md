# @aeolus-fleet/server

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) server: one tRPC API and the fleet domain on Postgres, with its migrations.

Pre-v1: the API changes without notice until the v1 acceptance test passes.

## Configuration

Environment variables, validated at startup (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres 16 or newer, with a direct connection |
| `HOST` | `127.0.0.1` | Interface to listen on |
| `PORT` | `4000` | Port to listen on |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy, so the sign-in rate limit counts per client address from `X-Forwarded-For` |

## Server commands

Run on the server, against the configured database, after `npm run db:migrate`:

| Command | Does |
| --- | --- |
| `npm run fleet:init -w @aeolus-fleet/server -- --name "<fleet name>"` | Creates the fleet and its operator ship `argo`, and prints argo's secret once. Refuses when a fleet already exists |
| `npm run argo:replace-secret -w @aeolus-fleet/server` | Replaces a lost argo secret: the old one stops working, every console session ends, the new secret is printed once |

The console signs in with argo's secret and keeps only a session cookie (httpOnly, Secure, SameSite=Strict), valid 30 days after its last use.
