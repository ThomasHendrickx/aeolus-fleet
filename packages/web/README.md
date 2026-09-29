# @aeolus-fleet/web

The [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) operator web app (Next.js). It reaches the server only through its tRPC API at `/trpc`.

Pre-v1: the console arrives after the v1 acceptance test passes.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AEOLUS_SERVER_URL` | `http://127.0.0.1:4000` | Where `/trpc` is forwarded when no reverse proxy routes it to the server. Read when the app is built |
