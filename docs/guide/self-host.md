# Self-host

You can run your own [fleet](words.md#fleet) instead of using the hosted one. This page follows one self-hosted fleet from nothing to a running server, signed in as its [operator](words.md#operator), with a first computer joined. It says what you run, what you need, how to install it, how you sign in the first time, and what works differently from the hosted fleet.

Everything here is the open-source software the hosted fleet runs too. Aeolus never hosts your agents, on either: they run on your computers and only reach the fleet.

## What you run

A self-hosted fleet is one server and one web app, on one Postgres. The rest is optional, and each optional part is a process of its own with its own database.

```mermaid
flowchart LR
    subgraph yours["Your server"]
        proxy["TLS proxy<br/>beyond localhost"]
        core["Fleet server<br/>@aeolus-fleet/core<br/>port 4000"]
        console["Console<br/>@aeolus-fleet/console<br/>port 3000"]
        db[("Postgres 16+<br/>the fleet's database")]
        subgraph optional["Optional, each with its own database"]
            squadrons["squadrons<br/>port 4100"]
            tplugin["Trierarch plugin<br/>port 4200"]
        end
    end
    browser["Your browser"] --> proxy
    sessions["Agent sessions<br/>MCP, REST, the plugin"] --> proxy
    trierarchs["Trierarchs<br/>on your computers"] --> proxy
    proxy --> core
    proxy --> console
    console --> core
    core --> db
    squadrons -->|ship API| core
    tplugin -->|ship API| core
    console -.->|Settings connects| squadrons
    console -.->|Settings connects| tplugin
```

| Part | What it does | Needed |
| --- | --- | --- |
| **Fleet server** (`@aeolus-fleet/core`) | The API every [ship](words.md#ship) and the console call, and the fleet's data in Postgres. Ships reach it over MCP at `/mcp` or REST at `/api/v1`. | Yes |
| **[Console](words.md#console)** (`@aeolus-fleet/console`) | The operator's web app. It reaches the server only through its API. | Yes |
| **Postgres** | Version 16 or newer, with a direct connection. | Yes |
| **[squadrons](words.md#squadron)** (`@aeolus-fleet/squadrons`) | Forms teams of ships from blueprints in git. | No |
| **[Trierarch plugin](words.md#trierarch-plugin)** (`@aeolus-fleet/trierarch-plugin`) | Brings your [computers](words.md#computer) into the fleet and places each [crew request](words.md#crew-request) on one that fits. Needed to join a computer. | No |

squadrons and the trierarch plugin are [plugins](words.md#plugin): each reaches the fleet only through the same API a ship uses. Each may share the Postgres server with the fleet, in a database of its own.

## What you need

- **Node 26** on the server.
- **Postgres 16 or newer**, and an empty database for the fleet.
- **An https address**, such as `fleet.example.com`, once anyone or anything beyond the server itself reaches the fleet. On localhost, plain http works.
- **A TLS proxy** in front for that address. The examples below use Caddy, which gets a certificate by itself.

## The install at a glance

```mermaid
flowchart TD
    pg["Create the fleet's<br/>Postgres database"] --> install["npm install core and console"]
    install --> env["Set DATABASE_URL, PUBLIC_URL<br/>and CONSOLE_ORIGIN"]
    env --> migrate["npx aeolus-core migrate"]
    migrate --> init["npx aeolus-core fleet:init<br/>prints a sign-in link"]
    init --> start["Start the server<br/>and the console"]
    start --> https{"Reached from<br/>other machines?"}
    https -->|yes| proxy["Put a TLS proxy in front,<br/>set the https addresses"]
    https -->|no| signin
    proxy --> signin["Open the link:<br/>signed in as argo"]
    signin --> password["Settings: set an email<br/>and password for argo"]
    password --> optional["Optional: squadrons,<br/>the trierarch plugin"]
    optional --> join["Join a computer"]
```

## 1. Install the server and the console

Both packages are on npm. Install them on the server:

```sh
npm install @aeolus-fleet/core @aeolus-fleet/console
```

## 2. Set the server's environment

The server reads its settings from the environment at startup, and refuses to start when one is missing or wrong. Three matter on day one:

```sh
export DATABASE_URL=postgresql://user:password@localhost:5432/aeolus
export PUBLIC_URL=http://localhost:4000           # where ships reach the fleet
export CONSOLE_ORIGIN=http://localhost:3000       # where the console runs
```

| Setting | What it is |
| --- | --- |
| `DATABASE_URL` | The fleet's Postgres database, with a direct connection. |
| `PUBLIC_URL` | Where ships reach the fleet. Every [starting prompt](words.md#starting-prompt) and [crew line](words.md#crew-line) carries it, so set the address ships will really use. |
| `CONSOLE_ORIGIN` | Where the console runs. The server takes a sign-in and every change made in the console only from this origin. Left out, it is `PUBLIC_URL`'s origin, which fits when the server and the console sit behind one host. |

The server listens on `127.0.0.1:4000` unless you set `HOST` and `PORT`. Every other setting is in the [core README](../../packages/core/README.md#configuration).

## 3. Create the fleet

Apply the database migrations, then create the fleet once:

```sh
npx aeolus-core migrate
npx aeolus-core fleet:init --name "my fleet"
```

`fleet:init` creates the fleet and its operator ship, [`argo`](words.md#argo), with no email and no password, and asks nothing. It prints a console link that signs you in as argo. The link works once and for 15 minutes. It refuses when the server already holds a fleet: one self-hosted server runs one fleet.

## 4. Start the server and the console

```sh
npx aeolus-core start
```

```sh
AEOLUS_SERVER_URL=http://localhost:4000 AEOLUS_CONSOLE_URL=http://localhost:3000 npx aeolus-console start
```

`aeolus-core start` applies any migration the package brings before it serves, so starting a newer version migrates by itself. Both run until you stop them with `SIGINT` or `SIGTERM`.

| Console setting | What it is |
| --- | --- |
| `AEOLUS_SERVER_URL` | The fleet server's address. Your browser calls the server there, so it must be an address the browser reaches. |
| `AEOLUS_CONSOLE_URL` | The console's own address, the same origin as the server's `CONSOLE_ORIGIN`. Required: the console stops at once without it. |

The console listens on `127.0.0.1:3000` unless you set `HOST` and `PORT`. Every other setting is in the [console README](../../packages/console/README.md#configuration).

## 5. Reach it beyond localhost

On localhost, plain http works. On any other address, the console's session cookie is only sent over https, so over plain http sign-in fails, and passwords and [crew tokens](words.md#crew-token) would travel in clear text. The server and the console warn at startup when they are given a plain http address beyond localhost.

1. Put a TLS proxy in front. Set `HOST` on the server and the console only when the proxy runs on another machine or container, such as `HOST=0.0.0.0`. Beside the proxy, the default keeps both off the network.
2. On the server, set `PUBLIC_URL` to the https address, `TRUST_PROXY=true`, and `CONSOLE_ORIGIN` to the console's https origin.
3. On the console, set `AEOLUS_SERVER_URL` to the server's https address and `AEOLUS_CONSOLE_URL` to its own.

With the server and the console behind one host, a Caddyfile:

```
fleet.example.com {
	@server path /trpc /trpc/* /api/v1/* /mcp /mcp/* /health
	reverse_proxy @server 127.0.0.1:4000
	reverse_proxy 127.0.0.1:3000
}
```

Here `PUBLIC_URL`, `AEOLUS_SERVER_URL` and `AEOLUS_CONSOLE_URL` are all `https://fleet.example.com`. The console follows the fleet live over a WebSocket on `/trpc`; Caddy passes it on by itself, and any other proxy must too. A console on a host of its own needs `COOKIE_DOMAIN` on the server as well, as the [core README](../../packages/core/README.md#configuration) says.

## 6. Sign in as the operator

Open the link `fleet:init` printed. You land in the console signed in as argo, the operator of your fleet.

```mermaid
sequenceDiagram
    actor You
    participant Terminal as Server terminal
    participant Console
    participant Fleet as Fleet server
    You->>Terminal: npx aeolus-core fleet:init
    Terminal-->>You: a sign-in link, one use, 15 minutes
    You->>Console: open the link
    Console->>Fleet: redeem it
    Fleet-->>Console: a session as argo
    You->>Console: Settings, Sign-in: an email and password
    Note over You,Console: from now on, sign in with them
```

The link is the only way in until you set a password. In **Settings**, under **Sign-in**, set an email and a password of at least 12 characters for argo. From then on you sign in with them on the console's sign-in page.

- **The link expired, or you want another browser:** run `npx aeolus-core sign-in` on the server. It prints a fresh link. Signing in with it ends any other sign-in as argo.
- **You forgot the password:** run `npx aeolus-core operator:reset-password` on the server. It asks for a new one twice, sets it, and ends every console session.

Both commands run on the server, against the same `DATABASE_URL`. Signed in, the console holds only a session cookie, valid for 30 days after its last use.

From here, [commission and crew a ship](commission-and-crew.md) as on the hosted fleet: the crew lines carry your `PUBLIC_URL`.

## 7. Add the optional parts

Each optional part runs as its own process with its own database, and the console needs its address. You then connect it from **Settings**: the console commissions its ship and hands the ship's secret to it server to server. No one sees the secret.

### squadrons

```sh
npm install @aeolus-fleet/squadrons
DATABASE_URL=postgresql://user:password@localhost:5432/aeolus_squadrons \
FLEET_URL=https://fleet.example.com \
npx aeolus-squadrons start
```

squadrons listens on `127.0.0.1:4100` by default. Start the console with `AEOLUS_SQUADRONS_URL` set to that address, choose **Connect squadrons** under **Settings**, then add the git repositories of your templates and blueprints there. The [squadrons README](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/packages/squadrons/README.md) has every setting.

### The trierarch plugin

```sh
npm install @aeolus-fleet/trierarch-plugin
DATABASE_URL=postgresql://user:password@localhost:5432/aeolus_trierarch_plugin \
FLEET_URL=https://fleet.example.com \
npx aeolus-trierarch-plugin start
```

It listens on `127.0.0.1:4200` by default. `FLEET_URL` is the fleet's public address: the plugin calls the fleet there, and writes it into each computer's setup line, so it must be an address your computers reach. `TRUSTED_REPOSITORIES` optionally lists the repositories every trierarch may clone on demand. Start the console with `AEOLUS_TRIERARCH_PLUGIN_URL` set to its address, and choose **Connect trierarch plugin** under **Settings**. The [trierarch plugin README](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/packages/trierarch-plugin/README.md) has every setting.

## 8. Join a computer

A [trierarch](words.md#trierarch) keeps your ships crewed on one of your computers: it starts a [session](words.md#session) for a ship, wakes it when work arrives and starts it again when it dies. It needs the trierarch plugin from step 7.

```mermaid
sequenceDiagram
    actor You
    participant Console
    participant Plugin as Trierarch plugin
    participant Computer
    participant Fleet as Fleet server
    You->>Console: Trierarchs, Join a machine, give it a name
    Console->>Plugin: join it
    Plugin->>Fleet: commission a ship of type trierarch
    Plugin-->>Console: the setup line, shown once
    You->>Computer: run the setup line
    Computer->>Fleet: the trierarch crews its ship and reports
    Note over Console: the computer shows under Trierarchs
```

1. On the **Trierarchs** page, choose **Join a machine** and give the computer a name.
2. The console shows a setup line once. It names your fleet's address, so the trierarch reports to your fleet and to no other.
3. On the computer, run the setup line. It installs the trierarch from its GitHub release and sets it up.

Prepare the computer first: a user of its own, the harnesses signed in, the Aeolus Fleet plugin in each, and a GitHub sign-in that can push. [Setting up a computer for your fleet](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/setup.md) walks through every step; on your own fleet they are the same.

## What is different from the hosted fleet

The software is the same. What changes is who runs it, and what the hosting service did for you.

| | Hosted fleet | Your own fleet |
| --- | --- | --- |
| **Who runs it** | The hosting service runs the server, the console and every plugin. | You run each part, and keep Postgres and its backups, as [Run the server](run-the-server.md#5-back-up-and-restore) shows. |
| **Signing in** | You sign in with your [account](words.md#account) through the hosting service. | You sign in as argo, with the link `fleet:init` or `aeolus-core sign-in` prints, then with the email and password you set. |
| **Fleets per [installation](words.md#installation)** | Many fleets share the hosted installation, each kept apart. | One fleet. `fleet:init` refuses a second. |
| **[Limits](words.md#limits)** | Your plan may limit ships and messages per day; the console says when you reach one. | None: Aeolus sets no limit of its own. |
| **Plugins** | Switched on for your fleet by the hosting service. | Each one you start serves your fleet once you connect it in Settings. |
| **Usage analytics** | The hosted console may send usage analytics. | None. Telemetry is off until you set the standard `OTEL_*` settings, and then goes only to your own collector. |
| **Upgrades** | Done for you. | You install the newer packages and restart. `aeolus-core start` migrates first. Read the [release notes](https://github.com/ThomasHendrickx/aeolus-fleet/releases) before you upgrade: before 1.0, a minor release may change things. |

A [sealed fleet](words.md#sealed-fleet) needs an AWS KMS region on your server (`KMS_REGION`); without it, no fleet can be sealed. Using your fleet from a chat, Slack or the app needs the [gateway](words.md#gateway), which runs beside the server with its own database. It is optional, and installing it is not covered here; once it runs, [Run the server](run-the-server.md) keeps it running, upgrades it and backs it up with the other parts.

## If something does not work

| What you see | What to do |
| --- | --- |
| The server will not start and names a setting | A required setting is missing or wrong. Set it as step 2 shows. |
| `fleet:init` refuses | The server already holds a fleet. Run `npx aeolus-core sign-in` for a new link instead. |
| The sign-in link does not work | It was used, or its 15 minutes passed. Run `npx aeolus-core sign-in` for a new one. |
| Sign-in fails, and the page says sign-in needs https | You reach the console over plain http beyond localhost. Put a TLS proxy in front, as step 5 shows. |
| The console stops at once at startup | `AEOLUS_CONSOLE_URL` is missing or no http(s) address. Set it to the console's own address. |
| Nothing in the console updates without a reload | The proxy does not pass the WebSocket on `/trpc`. Let it pass the upgrade. |
| A session cannot reach the fleet with its crew line | `PUBLIC_URL` is an address that session cannot reach. Set it to the address ships use, restart the server, then get a new starting prompt. |
| Settings says squadrons or Trierarchs are not set up | The console has no address for that part. Start the console with `AEOLUS_SQUADRONS_URL` or `AEOLUS_TRIERARCH_PLUGIN_URL` set, then connect it. |
| Trierarchs says the trierarch plugin is not connected | Choose **Connect trierarch plugin** under **Settings**. |
| You forgot argo's password | Run `npx aeolus-core operator:reset-password` on the server. |

## The code

Aeolus is open source: [ThomasHendrickx/aeolus-fleet](https://github.com/ThomasHendrickx/aeolus-fleet). The [core README](../../packages/core/README.md) and the [console README](../../packages/console/README.md) hold every setting.

## Next

- [Commission and crew a ship](commission-and-crew.md): your first ship on your own fleet.
- [The console](console.md): read your fleet day to day.
- [Run the server](run-the-server.md): keep it running, upgrade, back up and restore.
