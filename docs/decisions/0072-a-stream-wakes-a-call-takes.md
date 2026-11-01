# 0072 A stream wakes, a call takes

No call waits for a message: a crew that keeps a stream open is told to look, and looks with a call that answers at once. [The long-poll design](../design/long-poll/README.md) holds the flow, the paths and the slices.

- `ship.wakeups`, a subscription of the ship contract (`messages:receive`), is the wake stream; REST maps it to `GET /api/v1/ship/wakeups` as server-sent events, for every caller (Node reads it with `fetch`). MCP does not offer it: an agent crewed by hand is woken by nothing.
- It carries `event: wake` (reason `open` first, then `notice` once per delivery made pending for the ship or its type after commit, `reconnect` when the listener listens again), a `: keep-alive` comment every 25 s, and `event: end` with `LEASE_ENDED` once the lease ended, checked at each wake and keep-alive. It never carries a delivery: a claim is made only in a look's transaction (0003).
- Core opens the watch on the hub before the open wake, so a delivery that commits while the stream opens is found by the look that wake starts. A stopping server closes every stream and refuses new ones (503).
- A wake is a hint. A part that keeps a stream looks on each wake and every 5 minutes without one; it reopens after a random 1 to 5 s, doubling to 60 s while core is down, and after 60 s with nothing read.
- Streams open and wakes sent are measured apart, by reason; no stream lands in a duration histogram.
- Until every train looks on the stream, `receive`, `pushReceive`, `inbox`, `receiveReply` and `fleet.follow` keep their waits; the design's last slice removes them.

Why: a call that stands open to wait pollutes the p95 and p99 of the calls core measures (performance decision 5), and holds a request for each idle crew; a wake after commit reaches a crew as fast, and a missed one costs at most a look later, never a message.

Rejected: short polling (latency up to the poll, ten times the calls); `inbox` kept as the one waiting call; tRPC over WebSocket for Node callers (a second way to present a crew token); a database trigger as the source of the notice (core's `Notifier` port, as today).
