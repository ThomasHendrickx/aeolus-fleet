# Short setup for a self-hosted fleet

A developer with git, Node and Docker can start a fleet on their computer or their own server without filling in the Compose configuration by hand:

```sh
git clone https://github.com/ThomasHendrickx/aeolus-fleet-selfhost.git && cd aeolus-fleet-selfhost
npm run init
npm start
```

The scripts live beside `compose.yaml` and `.env.example` in [aeolus-fleet-selfhost](https://github.com/ThomasHendrickx/aeolus-fleet-selfhost). They use Node's built-ins, with no `npm install` or new npm package. The folder is also the supported place to run, upgrade and back up the fleet; see [Run the server](../guide/run-the-server.md). Upgrade with `git pull`, update the pinned versions in `.env` from `.env.example`, then `npm start`.

TLS and a public address, a person's self-hosted sign-in, and preparing and joining a computer are out of scope. A remote user reaches localhost through a tunnel. The self-hoster configures a public address and proxy separately as described in [Self-host](../guide/self-host.md).

## Init

`npm run init` asks four questions, each with an Enter default: Postgres in the folder or an existing server (folder by default), then squadrons (yes), the trierarch plugin (yes), and the gateway (no). `npm run init -- --yes` takes the defaults. The fleet's name can be changed in the console; ports follow Compose.

For folder Postgres, init generates database passwords. For an existing server, it asks for one connection URL per chosen part. It generates `GATEWAY_SECRET` when the gateway is selected, and writes secrets, URLs, plugin addresses and the chosen Compose profiles to `.env` without printing secrets. `COMPOSE_PROFILES` lets ordinary Compose commands run the same parts. Back up `.env` with the databases.

Running init again preserves generated passwords, secrets and settings the person changed. It changes the chosen profiles and plugin addresses, and adds the database URL and password needed by a newly chosen part. A password or secret already in use must not be regenerated.

The gateway is optional and off by default: Bridge and chats await the [self-hosted sign-in](self-hosted-sign-in.md). Until then, answer agents in the console inbox. The trierarch plugin runs on the server; joining a prepared computer remains Join a machine in the console.

## Start and stop

`npm start` runs `docker compose up -d --build`, waits for core's `/health`, and runs `fleet:init`. On the first start it prints the one-use sign-in link and opens it on a desktop. On a later start, `fleet:init` exits 3 when a fleet already exists; start opens the console's sign-in page and says `npm run sign-in` prints a fresh link. Other failures remain failures. A fresh link ends any other sign-in as argo. Links are always printed, including on a server without a desktop.

Start names each chosen plugin and its address for the person to connect under Settings. Starting a container does not connect it. It also points to the console inbox and Join a machine.

`npm run sign-in` runs `aeolus-core sign-in` in the core container. `npm stop` runs `docker compose down` and keeps volumes. Logs, backups and other operational commands stay in [Run the server](../guide/run-the-server.md).

## Site

The aeolus-site Run it yourself card shows the three commands above and names git, Node and Docker as prerequisites. Its before and after mockup belongs in aeolus-site.
