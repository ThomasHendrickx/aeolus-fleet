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
