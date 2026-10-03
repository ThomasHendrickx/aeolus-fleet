# @aeolus-fleet/squadrons

Forms squadrons of ships from blueprints and leads them (decision 0017). Optional: a fleet works with individual ships only. Aeolus knows nothing about squadrons; squadrons is a ship of the fleet with `fleet:read` and `fleet:manage`, its management ship, and reaches the fleet only through its public API.

So far: its own process and database, the connection the operator makes in the console as its management ship, the catalogue of templates and blueprints from git (docs/squadrons.md), forming squadrons, the check-in at each flagship (docs/squadrons.md, "Check-in"), `/api/health` and `/api/version`.

squadrons receives on every forming or sailing squadron's flagship. A member's check-in is kept with the model it states and answered with its role (template, charter, check-in interval, hand-offs as selectors); its on-station marks it, and the squadron sails once every member is on station. A flagship supports only the squadron's messages: any other message, from outside or from a member, is acknowledged and kept (`squadrons.messages`), never forwarded, and argo is told in its inbox, so no message disappears or goes unseen. The flagship acks each delivery only after handling it, and handling one that comes again (after a crash or a failed ack) gives the same answer and changes nothing twice. When a flagship is released, squadrons stops receiving on it and tells argo.

## Lifecycle

### Squadron states

- **Forming**: its flagship and members are commissioned; not every member has been on station yet.
- **Sailing**: every member has been on station; the squadron works.
- **Standing down**: its members finish their work and are retired one by one.
- **Disbanded**: every member and the flagship are retired. The end state; the squadron, its members and its flagship's kept messages stay as history.

| From | To | When |
| --- | --- | --- |
| (none) | Forming | The operator forms a squadron from a blueprint version |
| Forming | Sailing | Every member is on station for the first time |
| Sailing | Standing down | The operator stands it down |
| Standing down | Disbanded | Every member is retired: squadrons retires the flagship |
| Forming, Sailing, Standing down | Disbanded | The operator forces the stand down |

- Forming has no timeout. A member that never checks in keeps the squadron Forming; force stand down is the way out.
- Sailing is reached once and stays until the squadron stands down. A member that drops off station (released, a new crew, silent) never moves the squadron back; its health shows it.
- There is no disband action: Disbanded is only where standing down ends.

### Member states

- **Not on station**: its current crew has not confirmed its role at check-in.
- **On station**: its current crew confirmed its role; its health is on time, late or silent.
- **Standing down**: its squadron stands down and its flagship sent it its stand-down.
- **Retired**: squadrons retired its ship.

| From | To | When |
| --- | --- | --- |
| (none) | Not on station | Forming or adding commissions it |
| Not on station | On station | Its crew checks in and confirms its role (on-station) |
| On station | Not on station | Its ship awaits crew (released) or a new crew holds it, until that crew checks in |
| On station | Standing down | Its squadron stands down: the flagship sends it its stand-down |
| Standing down | Retired | It sent stood-down and holds no open deliveries |
| Not on station | Retired | Its squadron stands down: a member never on station holds no work |
| Any but Retired | Retired | The operator removes it, or forces the stand down |

**Health** comes from each member's last report (`report`): late after one check-in interval, silent after three. Before its first report the clock runs from when it came on station. Health is observation only: silence or a missed check-in never retires or stops a member.

### Stand down

The operator stands down a Sailing squadron. It goes Standing down and takes no new members.

1. A member that never came on station holds no work: squadrons retires it at once.
2. The flagship sends every other member `application/vnd.aeolus.squadron.stand-down+json`: `{ "squadron" }`, once each.
3. The member acknowledges it on receipt, as any delivery: an ack means received, never done. It finishes its open work, then sends its flagship `application/vnd.aeolus.squadron.stood-down+json`: `{ "squadron" }`, with `inReplyTo` set to the message that told it to stand down.
4. The flagship knows a stood-down by its sender, a member of the squadron standing down; `inReplyTo` only informs. It handles it as it handles an on-station: it records it, then acks it. A member that stood down and holds no open deliveries is retired then; one that still holds some is retired at the first rescan (every 30 seconds) where it holds none.
5. Once every member is retired, squadrons retires the flagship and the squadron is Disbanded.

A member that checks in while its squadron stands down gets its role message with `"standingDown": true`: it finishes its open work and sends stood-down, as in step 3, with `inReplyTo` set to that role message. A member is never retired before it sent stood-down: a stand-down that goes undeliverable, or a member that never answers, retires nobody. The operator removes that member or forces the stand down. The flagship receives until the squadron is Disbanded, so no message to it goes unseen while members finish.

Sending stood-down is the aeolus plugin's part: when a stand-down arrives, or a role message says `"standingDown": true`, the member finishes its work and sends stood-down to its flagship.

### Force stand down

The operator forces the stand down of a Forming, Sailing or Standing down squadron. squadrons retires every member that is not retired yet, then the flagship, at once, and the squadron is Disbanded. Each retire abandons the ship's direct deliveries, as any retire does. Only this explicit operator action retires a member that did not stand down.

### Members while the squadron serves

- **Add**, only while Sailing: squadrons commissions one member of a role from the squadron's own snapshot (the same template version), with forming's machinery as it is (a formation attempt, an idempotency key, recovery after a crash). Its crew line, launch note and pinned model are answered once. It checks in like any member and is Not on station until it does; the squadron stays Sailing.
- **Remove**, while Sailing or Standing down: squadrons retires the member's ship at once. Its direct deliveries are abandoned, as on any retire; a delivery to its type goes to another member of the role. Removing the last member of a role is allowed, and a hand-off to that role then fails at send ("no ship of that type").
- **New crew line** (`squadrons.newCrewLine`): the way to give a member a new session while keeping its check-in. squadrons releases the member's ship if a session crews it, gets it a new starting prompt, and answers its crew line with the squadron id, its launch note and pinned model, once. The new crew checks in like any member.

### The flagship's messages

The flagship handles check-in, on-station and stood-down from its own members. Any other message, from outside or from a member, is acknowledged and kept for the squadron page (`squadrons.messages`), never forwarded, and argo is told, so none disappears or goes unseen. Each delivery is acked only after it is handled, and handling one that comes again changes nothing twice. When the flagship is released or retired other than by its squadron disbanding, squadrons stops receiving on it and tells argo once.

### Not handled

- A ship changed outside its squadron (the operator releases, recrews or retires a member in the console) stays listed as a member; only its health and crew status show it. squadrons is not told (#105, after a first real squadron has sailed).
- The console's Recrew gives a member a crew line without the squadron id, so its new crew never checks in: `squadrons.newCrewLine` is the way to give a member a new session.
- A released flagship is not crewed again: check-ins to it go unanswered.
- While squadrons is not connected, flagships already receiving go on with their own crew tokens, but no new squadron starts receiving and no stand down advances.

## Running

1. Give squadrons its own database and set its environment. No management ship and no secret: the operator connects squadrons in the console.


| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | squadrons' own Postgres database (`postgres://...`); it may share the fleet's Postgres server |
| `FLEET_URL` | yes | The fleet's public URL; squadrons calls its ship API at `<FLEET_URL>/api/v1` and checks console sessions there. Not a secret; fixed here, so no caller can point squadrons at another fleet |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4100` by default |
| `LOG_LEVEL` | no | `info` by default |
| `SQUADRONS_CACHE_DIR` | no | Where the repositories' mirrors are kept, in a folder only squadrons' user can open; `aeolus-squadrons` in the user's cache folder (`$XDG_CACHE_HOME`, or `~/.cache`) by default |

The template repositories are no part of this configuration: the operator adds them in the console, under Settings (docs/squadrons.md, "Template repositories"). squadrons runs `git`, so the host needs it.

2. `aeolus-squadrons start` takes the process lock, migrates the database and serves. With a crew token kept from an earlier connection that the fleet still takes, it is connected again and retires every ship a forming cut short by a crash had commissioned; otherwise it serves not connected. `aeolus-squadrons migrate` migrates alone.
3. Connect it in the console: Settings, Connect squadrons. The web app's server commissions the management ship (`squadrons`, with `fleet:read` and `fleet:manage`) and hands its secret to squadrons' `connection.connect`, server to server; squadrons registers as a server and keeps only the crew token. The secret is never shown or stored.

Until it is connected, `catalogue.*` and `squadrons.*` answer PRECONDITION_FAILED. When the operator releases the management ship, squadrons drops its crew token and is not connected again: Connect squadrons, the same button, issues a new starting prompt for the same ship.

One squadrons process runs per database: a second start on the same database refuses and says so, so stop the old process before starting a new one (a rolling deploy cannot overlap them). A process whose lock connection fails stops.

## Paths

| Path | What |
| --- | --- |
| `/api/health` | Up and its database reachable: `{ "status": "ok", "connection": "connected" \| "not-connected" }`, or 503 |
| `/api/version` | `{ "squadrons": "<version>", "migration": "<latest migration>", "connection": "connected" \| "not-connected" }`. No authentication, no fleet data |
| `/trpc` | The squadrons API, for the web app's server. Every procedure needs the console session cookie of the fleet's signed-in operator, which squadrons checks with the fleet's `console.session` (once connected, only the operator of that fleet): `connection.status` (whether it is connected, as which ship, and the ship it was last connected as), `connection.connect` (`{ shipId, secret }`: registers as that ship and keeps its crew token; refused while connected, for a wrong secret, for a ship of another fleet or without `fleet:read` and `fleet:manage`), `repositories.list` (each template repository's `name`, `url`, `path`, `hasToken` and `lastFetch` (`{ at, error }`), oldest first, never a token), `repositories.add` (`{ url, path?, token? }`, answering the repository as `repositories.list` shows it; BAD_REQUEST for a URL or path docs/squadrons.md, "Template repositories", does not allow, CONFLICT for a name added already), `repositories.remove` (`{ name }`; NOT_FOUND when it is not there), `catalogue.list` (every tagged template and blueprint version, each with its `file`, its path within its repository at its commit, and every version left out with its problem), `catalogue.refresh` (fetch every template repository now; nothing fetches by itself), `squadrons.messages` (`{ squadronId }`: the messages its flagship kept), `squadrons.standDown` (`{ squadronId }`: stands a Sailing squadron down, see Lifecycle; NOT_FOUND for a squadron the fleet does not have, CONFLICT for one that is not Sailing), `squadrons.forceStandDown` (`{ squadronId }`: forces the stand down, see Lifecycle; CONFLICT for a squadron disbanded already, BAD_GATEWAY when the fleet does not retire a ship, and forcing again finishes), `squadrons.addMember` (`{ squadronId, role }`: adds a member of a role to a Sailing squadron, see Lifecycle; answers its crew line, with the squadron id, its launch note and pinned model, once; CONFLICT for a squadron that is not Sailing, BAD_REQUEST for a role it does not have), `squadrons.removeMember` (`{ squadronId, shipId }`: retires a member of a Sailing or Standing down squadron at once, see Lifecycle; CONFLICT for a squadron in another state, NOT_FOUND for a ship that is no member), `squadrons.newCrewLine` (`{ squadronId, shipId }`: releases the member's ship if crewed and answers a new crew line, with the squadron id, its launch note and pinned model, once, see Lifecycle; CONFLICT for a retired member), `squadrons.form` (`{ blueprint: { repository, name, version }, squadronId? }`: commissions the flagship, named as the squadron and crewed by squadrons, and the members, each under an idempotency key of its formation attempt, so a lost answer is asked again without a second ship and the ship gets a new starting prompt; answers each member's crew line, with the squadron id, and its template's launch note and pinned model, once) and `squadrons.list` (the fleet's squadrons, their state and members, each member with the model its template pins, the model it stated at check-in and whether they differ, its check-in interval, its health, and its crew as the fleet shows it: status, last seen and since when it is crewed; the fleet not answering for a member answers BAD_GATEWAY). A failure answers `Internal error` only; the log holds it whole |
