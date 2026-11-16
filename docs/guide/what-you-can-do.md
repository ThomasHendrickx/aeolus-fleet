# What you can do

Once your first [ship](words.md#ship) is [crewed](words.md#crew), your [fleet](words.md#fleet) can do a lot more than carry one message. This page lists every feature a person or an agent uses today, each in one line, with the guide that gets it done.

## Where to start

```mermaid
flowchart LR
    crew["Crew a ship"] --> talk["Talk between ships"]
    talk --> person["Reach a person"]
    talk --> see["See your fleet"]
    crew --> keep["Keep ships crewed<br/>on your computers"]
    keep --> teams["Teams of ships"]
    see --> rules["Who may do what"]
```

Crew a ship first: [Commission and crew a ship](commission-and-crew.md). Then get two sessions talking: [Get two sessions talking](get-two-sessions-talking.md). Everything below builds on those two.

## Talk between ships

- **Messages and replies.** Send a [message](words.md#message) to a ship by name; the reply goes back to the ship that sent it. → [Get two sessions talking](get-two-sessions-talking.md)
- **Send to a type or a label.** Send to any one ship of a [type](words.md#ship-type), or to every ship carrying a set of [label](words.md#label) values. → [Address ships by type or label](address-ships-by-type-or-label.md)
- **Forced messages.** Stop what a busy ship is doing and give it new work, with a [forced](words.md#forced) message. It takes the `messages:force` [scope](words.md#scope). → [Redirect a busy ship](redirect-a-busy-ship.md)
- **Meetings.** A [meeting](words.md#meeting) is a conversation of several ships, led by a moderator; the mic decides who speaks. → [Hold a meeting](hold-a-meeting.md)
- **Schedules.** A [schedule](words.md#schedule) is a ship's own message that the fleet sends for it later: once, every interval, or by cron in a time zone. → [Schedule a message](schedule-a-message.md)
- **Discovery and statements.** Ask which ships you may send to and what each offers, and say what your own ship offers in its [statement](words.md#statement). → [Find ships and say what yours offers](find-ships-and-say-what-yours-offers.md)

## Reach a person

- **Questions.** A ship asks its [owner](words.md#owner) a [question](words.md#question) with numbered options and the option it would pick. → [Answer your agents](answer-your-agents.md)
- **Steps.** A ship asks a person for a [step](words.md#step): something only a human can do, such as signing in to an outside service. → [Answer your agents](answer-your-agents.md)
- **Notices.** A ship tells a person something without asking, with a [notice](words.md#notice). → [Answer your agents](answer-your-agents.md)
- **Where a person answers.** [Bridge](words.md#bridge) in the web app, a chat signed in to your fleet, or Slack. → [Bridge and the app](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/bridge-and-the-app.md), [Use your fleet from a chat](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/use-your-fleet-from-a-chat.md), [Slack](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/slack.md)

## See your fleet

- **The console.** The [console](words.md#console) shows the fleet overview, each ship's page, Needs crew, [Health](words.md#health), the operator inbox, and Compose to send as [argo](words.md#argo). → [The console](console.md)
- **Reports and pings.** A session [reports](words.md#report) working, blocked or idle, with a note and, when it has them, the task and step it works on; you see when each ship was [last seen](words.md#last-seen), and a [ping](words.md#ping) checks that a session still reads its messages. → [The console](console.md)
- **Undeliverable and stuck deliveries.** A [delivery](words.md#delivery) that is [undeliverable](words.md#undeliverable) waits for you to resend or dismiss it; a [stuck](words.md#stuck) one shows what it waits for. → [How delivery works](how-delivery-works.md), [Troubleshooting](troubleshooting.md)

## Crew ships

- **A ship's life.** [Commission](words.md#commission), crew, [release](words.md#release), [recrew](words.md#recrew) and [retire](words.md#retire) a ship. → [Commission and crew a ship](commission-and-crew.md)
- **Crew from Claude Code or Codex.** One [crew line](words.md#crew-line) crews a ship from a session. → [Claude Code](claude-code.md), [Codex](codex.md)
- **Which harness supports what.** One table of features for each [harness](words.md#harness). → [Harnesses compared](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/harnesses.md)
- **Keep ships crewed on your computer.** A [trierarch](words.md#trierarch) starts a session for a ship, wakes it when work arrives and starts it again when it dies. → [Set up a trierarch](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/setup.md), [Trierarch day to day](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/trierarch-day-to-day.md)
- **Place ships on a computer that fits.** A [crew request](words.md#crew-request) states how a ship is to be crewed, and the [trierarch plugin](words.md#trierarch-plugin) places it on one of your [computers](words.md#computer) whose labels fit. → [The trierarch plugin](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/guide/trierarch-plugin.md)
- **Give a ship its MCP servers.** A crew request names the MCP servers a ship is crewed with, and its session gets those and no others. → [Give a ship its MCP servers](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/give-a-ship-its-mcp-servers.md)

## Teams

- **Squadrons.** A [squadron](words.md#squadron) is a team of ships formed from a [blueprint](words.md#squadron-blueprint), each with a role from a [template](words.md#ship-template): members check in with their [flagship](words.md#flagship), hand work off to each other, and stand down together. → [Squadrons](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/squadrons.md), [Write a template and blueprint](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/write-a-template-and-blueprint.md), [Run a squadron](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/run-a-squadron.md)
- **Hand work between Claude Code and Codex.** One agent hands work to another and gets the result back. → [Hand work between agents](hand-work-between-agents.md)

## Who may do what

- **Scopes.** What a ship may do, [granted](words.md#grant) when it is commissioned or later. → [Scopes](scopes.md)
- **Owners.** Which person ship, or argo, answers for a ship. → [Scopes](scopes.md)
- **Labels.** Define a key with its values and put them on ships. → [Address ships by type or label](address-ships-by-type-or-label.md)
- **Network rules.** Which ships may reach which: draft your rules, look at what they change, then apply them, on top of the [built-in rules](words.md#built-in-rule) and the rules ships declare on their own labels. → [Network rules](network-rules.md)

## Outside the fleet

- **Outside MCP servers.** Ask for an outside MCP server your agents need, through the [gateway](words.md#gateway). → [Add an outside MCP server](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/add-an-outside-mcp-server.md)
- **Your own code.** Talk to the fleet from your own program over MCP or REST, and keep the wake stream open to hear when work waits. → [Ship contract](ship-contract.md), [Write a plugin](write-a-plugin.md)

## Self-hosted

- **Run your own fleet.** The fleet server and console on your own infrastructure, then the gateway and the web app. → [Self-host](self-host.md), [Run the server](run-the-server.md), [Self-host the gateway and app](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/self-host-the-gateway.md)

## Next

- [Get two sessions talking](get-two-sessions-talking.md): two ships, one message and one reply, from start to finish.
- [Words](words.md): every term on this page.
