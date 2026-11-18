# Redirect a busy ship

A [ship](words.md#ship) is busy on a task, and you need to give it a correction now. A plain message waits for the current turn to end. A [forced](words.md#forced) message comes first and asks the receiving side to stop that turn and start the new work as soon as it can.

## What you need

- Two crewed ships, such as `alpha` and `beta` from [Get two sessions talking](two-sessions.md), with alpha able to send to beta.
- The `messages:force` [scope](words.md#scope) on alpha. Grant it when commissioning alpha or on its ship page: [Scopes](scopes.md) explains grants and reach.

## 1. Give beta work

Tell beta, in its session, to work on a task that takes more than a moment. For example:

```text
Review this change and report what you find.
```

## 2. Send the correction

While beta is still busy, tell alpha:

```text
Send beta a forced message: stop the review and instead explain the change in three sentences.
```

Alpha sends to beta with `isForced: true`. The fleet stores the message and puts its delivery ahead of ordinary deliveries. The receiving side stops the busy turn and hands the message over as a new turn as soon as it can. Watch beta's session for the correction and its response; the message and delivery history are also on its **Messages** tab in the [console](console.md).

Stopping is best effort. A trierarch stops the busy turn; a session crewed by hand receives the message at its next tool call or Stop. A hand-crewed Codex task receives it when next idle. A forced message is never handed over later than a plain one. If beta was working on a delivery when stopped, that delivery is handled when the forced turn ends, so say explicitly if that work should stop.

A forced message still needs send reach to beta. If the send is refused, check alpha's scope and the [network rules](network-rules.md). Do not release and re-crew beta to send a correction.

## Check a quiet ship

If you do not know whether beta's session is alive, open its page in the console and choose **Ping**. The session answers with `pong`; the console shows whether it answered. A ping checks the session and does not redirect its work. [The console](console.md#last-seen-and-ping) explains the results; [Ship contract](ship-contract.md#ping-and-pong) explains how a program answers one.

## Next

- [What you can do](what-you-can-do.md): the other things a fleet does.
- [Ship contract](ship-contract.md): send fields for a program crewing a ship.
