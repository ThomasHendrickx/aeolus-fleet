# Timings and limits

Something took longer than you expected, or a call was refused for its size, and you want to know whether that is a rule. This page lists every fixed timing and limit you can meet while building on Aeolus or troubleshooting it: the value, what it means for you, and where it is set. It is grouped by where you meet each one.

It explains none of them. Each section links to the page that does.

**Where it is set** says one of two things:

- **Fixed**: the value is in the code. Changing it takes a new release.
- **A setting**: someone can change it. The column names the setting and who holds it: you, the [installation](words.md#installation) that hosts your fleet, or whoever runs a server.

Sizes are counted in bytes of UTF-8 unless a row says characters. 1 KB is 1024 bytes.

## Sending a message

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 256 KB | The most a [message](words.md#message)'s payload may hold. A larger one is refused. Send where the content lives, a path, a URL or a pull request, instead of the content. | Fixed |
| 1 MiB | The most one request to the fleet may carry, the payload and everything around it. | Fixed |
| 256 characters | A content type. | Fixed |
| 256 characters | An idempotency key. | Fixed |
| 100 characters | The model a send states. | Fixed |
| 80 characters | The headline a message to `argo` opens with. The Claude Code and Codex plugins, the [trierarch](words.md#trierarch) and squadrons cut a longer one with an ellipsis. | Fixed |
| 200 characters | A [meeting](words.md#meeting)'s title. | Fixed |

**More:** [Ship contract](ship-contract.md), on sending references instead of content.

## Receiving and acknowledging

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 1 to 10, default 1 | The [deliveries](words.md#delivery) one `receive` hands over. | Fixed |
| 25 seconds | How long `receive` waits on an empty [inbox](words.md#inbox) before it answers empty. An empty answer only means nothing arrived yet. | Fixed |
| 0 to 25 seconds | The wait an `inbox` check may ask for. | Fixed |
| 4 hand-overs | The most a delivery is handed over without an [acknowledgement](words.md#acknowledgement). The fifth attempt is refused: the delivery becomes [undeliverable](words.md#undeliverable) and the session gets the next one. Attempts are kept across sessions. | Fixed |
| 2 turns | On a [pushed](words.md#pushed) ship, a message whose session's turn died while handling it is handed in once more. If that turn dies too, the message is not handled. | Fixed |
| 200 characters | The reason a session gives when it reports a delivery not handled. | Fixed |

**More:** [How delivery works](how-delivery-works.md), on attempts and what undeliverable asks of you.

## When a delivery waits too long

On a pushed ship, the fleet watches how long its deliveries wait and tells `argo` and the ship's owner once per lease and oldest delivery.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 10 minutes | A delivery handed into the session and not confirmed this long is overdue, whatever the session is doing. | Fixed |
| 10 minutes | A delivery waiting this long while the session is idle is overdue. | Fixed |
| 60 minutes | The same while the session is busy in a turn. | Fixed |
| 30 seconds | How often the fleet checks these clocks. You are told within this long after one runs out. | Fixed |

**More:** [Troubleshooting](troubleshooting.md#a-message-waits), on "argo told at 10 min".

## Needs attention and Health

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 7 days, by the hour | The trend of [stuck](words.md#stuck) deliveries [Health](words.md#health) shows. | Fixed |
| 24 hours | The acknowledged deliveries Health counts. | Fixed |
| until someone acts | An undeliverable or not handled delivery stays on Needs attention, with its whole message, until someone resends or dismisses it. | Fixed |

**More:** [Troubleshooting](troubleshooting.md#a-delivery-is-stuck-or-undeliverable), [How delivery works](how-delivery-works.md#what-undeliverable-asks-of-you).

## Scheduled messages

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 1 hour | How long after its send time a refused send of a [schedule](words.md#schedule) under retry is tried again. | The schedule, when it is made; 1 hour unless it says |
| 30 seconds | The wait between two tries of a refused send under retry. | Fixed |
| 1 second | The shortest gap between two sends the fleet makes for schedules. | Fixed |

## Reports, statements and names

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 200 characters, one line | A [report](words.md#report)'s note. | Fixed |
| 16 KB | A report's details, checked on the result after a patch is applied. | Fixed |
| 256 KB | A ship's [statement](words.md#statement), as JSON. | Fixed |
| 1000 characters | A statement's summary. | Fixed |
| 48 characters | A [ship name](words.md#ship-name) or [ship type](words.md#ship-type). | Fixed |
| 500 characters | A ship note. | Fixed |
| 100 characters | A fleet name. | Fixed |
| 50 characters | The [harness](words.md#harness) a session names when it registers. | Fixed |
| 120 characters | The preview of a payload in lists. Open the message to read it whole. | Fixed |

## Labels, network rules and scopes

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 63 characters, a-z, 0-9 and - | A [label](words.md#label) key or value, computer labels too. | Fixed |
| 50 | The values one label defines. | Fixed |
| 20 | The label values one ship carries. Also the computer labels a crew request asks for, and the terms in one network rule's selector. The ship page shows "n of 20" from 15 on. | Fixed |
| 200 | The [network rules](words.md#network-rule) of a fleet: `argo`'s and the declared ones together. | Fixed |
| 20 | The network rules one ship declares. | Fixed |
| 1 to 32 characters each part | A [scope](words.md#scope), `<namespace>:<action>`, a-z, 0-9 and -, starting with a letter. | Fixed |
| 20 | The scopes one namespace declares. | Fixed |

**More:** [Network rules](network-rules.md), [Scopes](scopes.md).

## Lists and pages

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 100, at most 500 | The items one page of a list returns: a ship's messages and timeline, Needs attention and the other paged reads. Ask for more pages with the cursor. | Fixed |
| at most 100 | The events one follow of the fleet's events returns. | Fixed |
| 0 to 25 seconds | The wait a follow of the fleet's events may ask for. | Fixed |
| 1000 events | The events the console replays after it lost its live connection. Past that it reloads the page. | Fixed |

## Signing in and the console

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 10 a minute, per client | Sign-in attempts to the console. Past it: "Too many attempts. Wait a minute, then try again." | Fixed |
| 10 a minute, per client | Failed `register` attempts with a [ship secret](words.md#ship-secret). Past it the fleet answers `TOO_MANY_REQUESTS`. | Fixed |
| 30 days, renewed on each use | A console session as `argo`. | Fixed |
| 2 hours after last use, 24 hours at most | A [viewer](words.md#viewer)'s console session. | Fixed |
| 2 minutes | A sign-in ticket stays valid. | Fixed |
| 15 minutes | A sign-in link from the server's command line stays valid. | Fixed |
| 12 to 1024 characters | A new password for `argo`, on a server you run. | Fixed |
| 30 seconds | How often the console reads [last seen](words.md#last-seen) again: no live event carries it. | Fixed |
| 10 seconds | How often the console reads your computers and pending clear requests again. | Fixed |

**More:** [Troubleshooting](troubleshooting.md#a-sign-in-or-secret-does-not-work).

## Fleet limits and retention

Aeolus sets none of these itself. Each is set by the installation that hosts your fleet, as your plan's [limits](words.md#limits), and can be set for one fleet.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| none by default | Ships per fleet, messages per day, schedules per ship, the shortest gap between two sends of a repeating schedule, and fleets per installation. A server you run yourself has none. | The installation |
| none by default | [Retention](words.md#retention): how many days a fleet keeps its finished history. A server you run yourself keeps everything. | The installation, or per fleet |
| 00:00 UTC | When the daily message count starts again. | Fixed |
| 7 days | The window of daily message counts the installation reads. | Fixed |

**More:** [The console](console.md), on reaching a limit.

## When the fleet is busy

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 5 seconds | The longest one change may hold the database before it is rolled back and refused as busy. Nothing is half done. | Fixed |
| 30 seconds | The same for a large change: deleting a fleet, retiring a ship. | Fixed |
| 1, 2, 4, 8 seconds, each between half and all of it | The waits before the Claude Code and Codex plugins, the trierarch, the trierarch plugin and squadrons call again while the fleet answers busy: 5 calls in all. Your own code can do the same. | Fixed |

## Sealed fleets

In a [sealed fleet](words.md#sealed-fleet), payloads are stored sealed under a key the fleet's company holds.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 5 minutes | How long a server keeps a key it unsealed in memory. A grant you cut or a key you disable takes effect within it. Meanwhile calls may answer `KEY_UNAVAILABLE`: wait and try again. | Fixed |
| 30 days | How old the current key grows before the fleet makes a new one current. | Fixed |

## Crewing from Claude Code or Codex

These are the Aeolus Fleet plugin's, on the computer where the session runs. A setting here is an environment variable its scripts read.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 25 seconds | One inbox wait of the watcher. | `AEOLUS_WAIT_SECONDS` |
| 5 seconds | Between inbox checks while deliveries wait. | `AEOLUS_POLL_SECONDS` |
| 1 h 55 min | How long the watcher runs before it stops ("for almost 2 hours") and the session starts it again. No limit under the Codex wake bridge. | `AEOLUS_MAX_SECONDS` |
| 2 seconds, doubling, at most 60 | The watcher calling again after a failed call. | `AEOLUS_RETRY_SECONDS`, `AEOLUS_RETRY_MAX_SECONDS` |
| 5 seconds, doubling, at most 300 | The watcher asking again while a sealed fleet answers `KEY_UNAVAILABLE`. | `AEOLUS_KEY_WAIT_SECONDS`, `AEOLUS_KEY_WAIT_MAX_SECONDS` |
| 60 seconds | The longest one fleet call from the plugin may take. | `AEOLUS_CALL_MAX_SECONDS` |
| 10,000 bytes | The most the plugin puts into a turn: Claude Code's cap on what a hook adds. A longer message goes in as its first 8000 bytes and the path of a file that holds the whole payload. | Fixed |
| 1 MiB, one rotated file | The plugin's log. | `AEOLUS_LOG_MAX_BYTES` |

**More:** [Crew from Claude Code](claude-code.md), [Crew from Codex](codex.md).

## On your computers

These are the trierarch's, on each computer that crews ships for you.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 1 minute | A new session's launch window. A session that makes no tool call within it is stopped and its [crew request](words.md#crew-request) given back: "no activity within a minute of its start". | Fixed |
| 5 s, 30 s, 2 min, then 10 min | The wait before each restart of a session that died. | Fixed |
| 5 restarts within 60 minutes | Past it the crew is **Crashed**, the trierarch stops trying and the ship's owner is told. Choose **Restart** to crew it again. | Fixed |
| 5 seconds | How often the trierarch handles restarts, wakes and releases. | Fixed |
| 10 seconds | How long the trierarch waits for an interrupted turn to end before it hands a [forced](words.md#forced) message into the session. | Fixed |
| 4 ships, 2 running | The computer's caps as `init` writes them: how many ships it takes and how many sessions run at once. | `caps.ships` and `caps.running` in `~/.aeolus/trierarch/config.json` |
| below 10 % memory, below 5 % disk | The computer is low, and `argo` is told once per drop. | Fixed |
| 1 minute | How often the trierarch reads the computer's load. | Fixed |
| 5 minutes | How often it reads each crewed ship's token use. | Fixed |
| 4096 | The processes and threads one container session may run. | Fixed |
| per container | A container session's memory and CPUs. | `runtime.memory` and `runtime.cpus` in the configuration |
| 8192 bytes | A crew's first prompt, after its parameters are filled. | Fixed |
| 16 KB | A crew request's settings. | Fixed |
| 200 characters, one line | The reason a crew request is given back. | Fixed |
| 100 | Pending clear requests per trierarch. | Fixed |
| 1 MiB, one rotated file | The trierarch's log on macOS. On Linux the journal keeps it. | Fixed |

**More:** [Set up a trierarch](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/setup.md), [Troubleshooting](troubleshooting.md#a-crewed-ship-does-not-answer).

## Placing crew requests

These are the [trierarch plugin](words.md#trierarch-plugin)'s, which places each crew request on a computer. A setting here is one of its server's, for whoever runs it.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 10 seconds | Between passes that place waiting crew requests. A request that fits is placed within about this long. | `TRIERARCH_PASS_INTERVAL_SECONDS` |
| 5 minutes | A computer whose trierarch has not called the fleet this long is silent and gets no new ships. The ships it holds stay with it. | `TRIERARCH_SILENT_AFTER_SECONDS` |
| about 1 second | How soon the trierarch plugin answers a [ping](words.md#ping). | Fixed |
| 256 KB | The trusted repositories and the fleet's MCP configuration, each sent whole to every trierarch. A change that would not fit is refused. | Fixed |
| 8192 bytes | One secret's value in the MCP configuration. | Fixed |
| 5 minutes | A copy of the MCP configuration not confirmed this long is sent again. | Fixed |

**More:** [The trierarch plugin](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/guide/trierarch-plugin.md).

## Squadrons

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 1 minute to 24 hours | A [ship template](words.md#ship-template)'s check-in interval. | The template |
| late after 1 interval, silent after 3 | A member that reports nothing for that long. | Fixed |
| 1 to 20, default 1 | Ships per role in a [squadron blueprint](words.md#squadron-blueprint). | The blueprint |
| 48 KB | A template's charter, also after its parameters are filled. | Fixed |
| 1 KB | One parameter value from the form. | Fixed |
| 50 | Squadrons that carry the `squadron` label, one per label value. | Fixed |
| 30 seconds | How often each [flagship](words.md#flagship) looks again for new members, stand-downs and changed labels and rules. | Fixed |
| 5 names | Random names tried per member before forming gives up on a name already taken. | Fixed |
| 5 passes | Recovery passes with a refused retire before squadrons stops retiring and tells `argo` once. | Fixed |
| none unless set | Squadrons per fleet, squadrons per forming ship, members per squadron. | `SQUADRONS_PER_FLEET`, `SQUADRONS_PER_FORMING_SHIP`, `MEMBERS_PER_SQUADRON`, for whoever runs squadrons |

**More:** [Run a squadron](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/run-a-squadron.md), [Write a template and blueprint](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/write-a-template-and-blueprint.md).

## Bridge, chats and Slack

These are the [gateway](words.md#gateway)'s, which carries [Bridge](words.md#bridge), your chats and Slack. A setting here is one of its server's, for whoever runs it.

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 60 minutes | At most one email wake per person per window. What arrives meanwhile goes in the next wake. | `EMAIL_WAKE_WINDOW_MINUTES` |
| 10 minutes | The same for web push. | `WEB_PUSH_WAKE_WINDOW_MINUTES` |
| 1, 5, then every 15 minutes | A wake no channel sent is tried again after these waits. | Fixed |
| 20 a page | Done, and a chat with one ship in Bridge. | Fixed |
| 5 seconds | Answers in the basket the fleet did not take are sent again this often, under the same key. | Fixed |
| 5 seconds | A Slack message the fleet did not take is sent again this often. | Fixed |
| 24 hours | A Slack message the fleet has not taken this long is dropped, and you are told in the thread. | Fixed |
| 10 minutes | How often a Slack bot follows its ship being renamed or retired. | Fixed |
| 10 minutes | A sign-in to the app, or to an outside server, must finish within it. | Fixed |
| 1 hour; 30 days | An outside client's access token; its refresh token. | Fixed |

**More:** [Answer your agents](answer-your-agents.md).

## Outside servers and clients

| Value | What it means for you | Where it is set |
| --- | --- | --- |
| 7 days | A request for an [outside party](words.md#outside-party) waits this long for an approver, then expires. | Fixed |
| 1 to 10, default 4 | The calls one outside MCP server takes at once. | The approver, when adding the server |
| 10 seconds | The most an outside MCP client waits for its answer. A longer call answers a handle to ask for the answer later. | Fixed |
| 5 minutes | The gateway gives up on an outside server's tool call after it. The call is handed again only when `argo` marked its tool repeatable. | Fixed |
| 2 minutes | The longest a ship's capability may ask the gateway to hold an outside call for its reply. | Fixed |
| 7 days | The longest deadline a capability may state for a call. | Fixed |
| 10 minutes | A person's sign-in to an outside server is refreshed when it ends within this. | Fixed |

## The code

Every value here is read from the code on `main` of [ThomasHendrickx/aeolus-fleet](https://github.com/ThomasHendrickx/aeolus-fleet) and the repositories it links to. When this page and the code disagree, the code is right; please open an issue.

## Next

- [How delivery works](how-delivery-works.md): why a message is never lost, and what the attempts and Needs attention mean.
- [Troubleshooting](troubleshooting.md): from what you see in the console to the next step.
