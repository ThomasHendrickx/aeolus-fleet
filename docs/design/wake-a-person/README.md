# Wake a person when something waits

Design for [#1020](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1020) (interop I-1, 5.1 (a)) and [#1014](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1014), as one design for Aeolus 0.30.0. Docs only.

## 1. Purpose (agreed by Thomas)

A person learns that something waits for their person ship when they are not looking, through a channel they chose, and the gateway's pages show their inbox as it changes. Both come from one part: the gateway, as crew of the person ship, hearing the ship's deliveries.

The outcomes:
1. A delivery reaches Mathilde's person ship while they are away. Within a minute their phone or mailbox says that something waits in their fleet, with a link to the gateway's overview. The wake carries no content.
2. With the overview open, Waits on you and their inbox change within seconds when a delivery arrives, and when they open, answer or mark done one in any client.
3. Every wake is a hand-over on the record (0040, interop 5.1): the lease shows the gateway as its waker, and the delivery shows that it was handed, through which channel and when.
4. Core sends no notification and holds no address. The person ship's crew acts, as the trierarch does for a session.

Later (Thomas):
- Waking agent ships.
- Waking the proxy ships of outside MCP clients.
- MCP resource subscriptions: the protocol's own push to a chat client (I-1 (b)).

Not the purpose:
- A person's own app holding the lease (waker `personApp`).
- Reminders, quiet hours or escalation beyond what W3 decides.

## 2. What is true today

- **Core.** `pushReceive` takes a `waker` (`gateway` among the values) at the lease's first push receive (`LeasePushed`), and `handed` takes a `channel`, kept with `DeliveryHanded`. A person ship runs no clocks (0040) and is never stuck (0042). `inbox` waits up to 25 seconds only while nothing waits; it counts the crew's own received and handed deliveries too, so it answers at once while any are held.
- **Gateway** (`aeolus-fleet-gateway`, `src/core/people`):
  - It crews a person ship the first time its person signs in, and keeps the crew token in `person_crews`, shared by all of the person's clients.
  - `people.inbox` (the overview, `aeolus_inbox`) push receives with no `waker`, so a lease the gateway crews states none. `aeolus_open` acks for the person; answer and done report `handled`.
  - The pages' live channel hears only the gateway's own database: a trigger on `pending_requests` sends `NOTIFY gateway_changes` with the fleet and topic `requests`, every instance listens, and a lost connection reads everything anew.
  - It holds no email address and sends no email. pagasae signs every account in by email link (0054) and holds the address.
  - Proxy ships of outside MCP servers poll `pushReceive` while they hold in-flight deliveries (`run-party`), since `inbox` would answer at once.

## 3. Lessons to check against

- **0001, 0040.** The promise ends at the actor's confirmation. For a person that is opening the delivery (the gateway's ack). A wake is a hand-over: it counts an attempt, a repeat with the same number counts none, and the fifth is undeliverable.
- **I-1 (5.1 (a)).** One wake pattern for every kind: the crew's computer side push receives, hands over through its actor's channel and reports `handed` naming it. The fleet never speaks for a ship; (b) core notifying was rejected.
- **#1020.** The wake carries only that something waits and a link, no content.
- **I-8.** One waiting call per ship the gateway crews; a core call waiting on many ships is not built until numbers demand it.
- **0016.** No policy: what a wake carries and how often is the person's or the configuration's, not a rule core applies.
- **0045, 0052.** A person ship owns itself, so its owner configuring the channel is the person.
- **0054, 0058.** Email stays in pagasae; core holds none.
- **0033 and the gateway's pages.** Logic on the server; the browser renders what it is given. Live over a socket, not polling ("websockets over polling", #1014).
- **0013.** No compatibility work; keep it minimal.

## 4. Flow

The backbone: one waiter per person ship the gateway crews.

```mermaid
flowchart TD
  start([Gateway holds the person ship's crew]) --> wait["inbox, waiting while the count is the one it knows (W5)"]
  wait -->|count unchanged after the wait| wait
  wait -->|fleet does not answer| backoff[Wait, longer each time] --> wait
  wait -->|LEASE_ENDED or UNAUTHORIZED| stop([Drop the crew, stop the waiter. Next sign-in crews again])
  wait -->|count changed| notify["NOTIFY gateway_changes: fleet, ship, topic inbox"]
  notify --> pages[Open pages of that person read people.inbox again]
  notify --> more{Count rose?}
  more -->|no: opened or done elsewhere| wait
  more -->|yes| take["pushReceive, waker gateway: new ones and its own held ones"]
  take --> fresh{Any never handed?}
  fresh -->|no: woken before| wait
  fresh -->|yes| open{"A page of the person open? (W6)"}
  open -->|yes| page["handed no. 1, channel page"] --> wait
  open -->|no| chosen{Channel chosen?}
  chosen -->|none| none[Stays received: shown on the next look, lease shows nothing handed] --> wait
  chosen -->|yes| send[Send the wake: something waits, and the overview link]
  send -->|went out| handed["handed no. 1, channel email, web-push or webhook, for each fresh one"] --> wait
  send -->|push subscription gone 404 or 410| drop[Forget that subscription; the page says so] --> chosen
  send -->|channel failed| retry[Not handed; tried again at the next turn of the loop, longer each time] --> wait
  handed -.->|person opens| ack([aeolus_open acks: the promise ends])
```

Unhappy paths the diagram does not show:
- **Crash after the wake, before `handed`.** On restart `pushReceive` returns it again, never handed, so it is woken again: one duplicate wake, nothing lost.
- **Crash after `handed`.** It comes back with its last hand-over number 1: no second wake.
- **The person opens it before the wake goes out.** `handed` answers `acknowledged`; nothing more.
- **Lost `NOTIFY` connection.** The listener reads everything anew, as for `requests` today.
- **Account disabled (0055).** Its person ship is released, the waiter's next call answers `LEASE_ENDED`, and it stops.
- **Two gateway instances.** One waiter per ship across instances; a second only duplicates a wake, never loses one.

## 5. Questions

Each stands on its own: context, options, my pick and why.

### W1 Which channels does 0.30.0 offer?

Context: I-1 names three channels a person's owner may configure: email, web push and a chat tool's incoming webhook. Each is its own adapter with its own setup. Email needs a sender and the person's address; web push needs the gateway's push keys and the person allowing it in each browser; a webhook needs a URL the person pastes, which is a secret and posts into a space others may read.

1. **Email and web push.**
2. Email, web push and a chat webhook.
3. Web push only.
4. Email only.

**Pick 1.** Email reaches every account with nothing to set up, and web push reaches the device at once. The webhook carries a secret to keep and posts where others read; it follows when a person asks for it.

### W2 Who sends the email?

Context: the gateway holds no email address and sends no email today. pagasae holds every account's address and already sends the sign-in links (0054). Core holds no email (0058).

1. **pagasae, asked by the gateway to send an account a wake.** The address never leaves pagasae.
2. The gateway, with its own mail configuration and the address read from pagasae.

**Pick 1.** One store of addresses and one mail setup. Option 2 copies addresses into the gateway's database and adds a second mail configuration to run.

### W3 When does a wake go out?

Context: a wake is a hand-over (0040): the gateway reports `handed` no. 1 for each delivery it wakes the person about. A repeat with the same number counts nothing, and the fifth attempt makes a delivery undeliverable, so each delivery is handed once. Deliveries can arrive in bursts, and a person may leave old ones unopened.

1. One wake for every delivery.
2. **One wake for every delivery never handed, gathered: at most one wake per channel within a window from the gateway's configuration (10 minutes by default). What arrives inside the window goes in the next wake.**
3. Only when the inbox goes from empty to not empty.

**Pick 2.** The record stays exact (every delivery handed once) and a burst of ten sends one wake. Option 1 floods; option 3 never tells a person with one old unopened delivery about a new one.

### W4 What does the wake say?

Context: #1020 decided that a wake carries no content, only that something waits and a link. Interop 5.1's example also showed the sender and title, as the owner's choice. Anything in an email or push leaves the fleet.

1. **Only that something waits in the fleet, by the fleet's name, and a link to the gateway's overview.**
2. Option 1, and how many wait.
3. Option 1, and the sender and title, if the person turns that on.

**Pick 1.** It is what #1020 decided. A count goes stale as the person deals with deliveries in another client, and a title is content.

### W5 How does the gateway hear a new delivery while earlier ones wait unopened?

Context: the gateway learns of deliveries with the ship call `inbox`, which waits up to 25 seconds while nothing waits. It counts the crew's own received and handed deliveries too, so once the gateway took one the person has not opened, `inbox` answers at once on every call and can no longer wait for the next one. A person may leave a delivery unopened for days. The gateway's proxy ships of outside MCP servers poll `pushReceive` for this reason today.

1. **A core change: `inbox` takes the count the caller already knows and waits while the count is still that.**
2. The gateway polls `pushReceive` every few seconds while it holds unopened deliveries.

**Pick 1.** One input on one call, claiming nothing. The same answer tells the pages when the count goes down, as when the person opens one elsewhere. Option 2 polls for days per person, against "websockets over polling" (#1014).

### W6 What happens while the person has a gateway page open?

Context: the gateway knows a page is open by its live socket, which shows Waits on you as it changes (outcome 2). Without a rule, a delivery that arrives while the person looks at it also sends an email or push.

1. **The page is the channel: the gateway reports `handed` with channel `page`, and sends no email or push.**
2. Wake through the chosen channels anyway.

**Pick 1.** The person is already looking, and the record still names how it reached them.

### W7 Which person ships does the gateway wait on?

Context: the gateway crews a person ship the first time its person signs in and keeps the crew token. I-8: one waiting call per ship the gateway crews; a core call waiting on many ships is not built until numbers demand it. The live pages need the wait whether or not a channel is chosen.

1. **Every person ship it crews.**
2. Only those whose person chose a channel or has a page open.

**Pick 1.** One loop serves both the wake and the live pages, and it starts whenever the gateway crews. Option 2 starts and stops waiters as pages open and close, for a cost I-8 says to measure first.

### W8 How does the person choose their channels?

Context: a person ship owns itself (0045), so the owner I-1 says configures the channel is the person. The gateway's overview is the page every signed-in person has. Web push is allowed per browser.

1. **A section on the gateway's overview: email on or off, and web push turned on for this browser (one subscription per browser, each removable). Nothing on by default. Kept in the gateway's database by fleet and person ship.**
2. The same, with email on by default.

**Pick 1.** A person receives only what they turned on. A person who never turns one on is woken by nothing, which their deliveries show: waker gateway, nothing handed. Option 2 emails people who never asked.

## 6. What the build needs (once agreed)

- Core: W5's `inbox` input (one slice, with its Testcontainers wait test).
- Gateway: the waiter, the `inbox` topic on `gateway_changes`, the pages re-reading on it; `waker: gateway` on every push receive; the channels and their section on the overview; with W2 (1), a pagasae call to send a wake.
