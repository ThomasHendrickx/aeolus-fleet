# Hand work between agents

You run Claude Code and Codex. One writes a change, the other reviews it, and today you carry the work between them: copy the pull request link from one window, paste it into the other, wait, copy the review back. This page connects the two so they hand work to each other directly, as two [ships](words.md#ship) of your [fleet](words.md#fleet) sending each other messages. It follows one hand-off from the task to the review that comes back, and then the same hand-off with a session restarting in the middle of it.

What you get: a hand-off that survives a restart. A task sent is stored before the sender hears OK, waits for the receiving ship whatever state its session is in, and its answer finds its way back to the sending ship, not to the window that sent it.

## Two ships, one per harness

Every agent that takes part is a ship: a named inbox in the fleet that a [session](words.md#session) crews. The example on this page uses two:

| Ship | [Type](words.md#ship-type) | Crewed from | Its job |
| --- | --- | --- | --- |
| `writer` | `writer` | Claude Code | Writes the change, sends it for review, acts on the review |
| `reviewer` | `reviewer` | Codex | Reviews what it is sent and answers with its review |

The names are yours to choose. Each ship works in its own folder: one folder crews one ship, and a git worktree is its own folder, so both can work on the same repository.

```mermaid
flowchart LR
    you["You"] -->|"a task, in the session<br/>or from Compose"| writer
    subgraph cc["Claude Code"]
        writer["writer"]
    end
    subgraph cx["Codex"]
        reviewer["reviewer"]
    end
    writer -->|"review request<br/>with the PR link"| fleet["Fleet<br/>stores every message"]
    fleet --> reviewer
    reviewer -->|"the review,<br/>in reply"| fleet
    fleet --> writer
```

## Set it up

1. **Install the plugin in both harnesses.** Once per computer. For Codex, also let its sandbox reach the fleet and trust the plugin's hooks. Each guide has the steps: [Crew from Claude Code](claude-code.md#install-the-plugin) and [Crew from Codex](codex.md#install-the-plugin).
2. **[Commission](words.md#commission) two ships** in the console: `writer` and `reviewer`, each with the type of its job. [Commission and crew a ship](commission-and-crew.md) covers each field.
3. **Crew each one.** Start Claude Code in the writer's folder and paste the writer's Claude Code [crew line](words.md#crew-line). Start a new Codex task in the reviewer's folder and paste the reviewer's Codex crew line. Both ships show **Crewed** in the console before you send the first task.
4. **Tell each agent who it works with.** The agents know how to send and answer from the plugin. What they do not know is your team: tell the writer to send its finished change to `reviewer` and wait for the review, and the reviewer to answer whoever sends it work. A ship can also find the others itself: each ship states what it offers in its [statement](words.md#statement), and the ships it may send to are listed for it on request.

If your fleet has [network rules](words.md#network-rule), the writer needs a rule that lets it send to the reviewer. The reviewer needs none to answer: a ship can always answer the message it was sent.

## One hand-off

You give the writer its task, in its Claude Code session or from **Compose** in the console. From there you copy nothing.

```mermaid
sequenceDiagram
    actor You
    participant W as writer (Claude Code)
    participant F as Fleet
    participant R as reviewer (Codex)
    You->>W: the task
    W->>W: writes the change, opens a pull request
    W->>F: send to reviewer: review this PR, with its link
    Note over F: stored, then OK
    F-->>W: OK
    Note over W: the turn ends, the session waits
    F-->>R: a message waits
    Note over R: the task wakes with it
    R->>F: ack: received
    R->>R: reviews the pull request
    R->>F: send to writer, in reply: the review
    F-->>R: OK
    F-->>W: a message waits
    Note over W: the session wakes with it
    W->>F: ack: received
    W->>W: acts on the review
```

What happens at each step:

- **The send.** The writer sends a [message](words.md#message) to `reviewer`: a short task and where the work lives, such as the pull request link. The fleet stores it before the writer hears OK. A message holds at most 256 KB and carries the work, not the workspace: your code, branches and each agent's folder stay where they are, so send a reference the reviewer can open.
- **The wait.** The message waits in the reviewer's [inbox](words.md#inbox). Neither agent spends tokens while it waits.
- **The wake.** When the reviewer's task is idle, the plugin wakes it with the message. If it is busy, the message waits for its turn to end.
- **The ack.** The reviewer's [acknowledgement](words.md#acknowledgement) means received, not done. Aeolus delivers the work; it does not run it, and it does not know when the review is finished.
- **The answer.** The reviewer sends its review to `writer`, as a reply that names the review request. The reply is how the writer learns the work is done. The writer wakes the same way the reviewer did.

The hand-off back works the same way: the writer can send the reviewer a fixed version, and the reviewer answers again. Every message in the exchange is one thread in the console.

### Address a ship or a type

The writer can send to one ship by name, `reviewer`, or to any one ship of a type, `reviewer` as a type. With a type, the first ship of that type to take it gets it, so two reviewers can share the work. If no ship of the type exists, the message waits on Health under **No ship can take** until you commission one.

## A session restarts mid hand-off

Sessions die, clear, compact and restart. A hand-off is built to outlast them, because the work lives in the fleet and the ship, not in a session.

```mermaid
sequenceDiagram
    participant W as writer (Claude Code)
    participant F as Fleet
    participant R as reviewer (Codex)
    W->>F: send to reviewer: review this PR
    Note over F: stored, then OK
    F-->>W: OK
    Note over W: the writer's session restarts
    F-->>R: a message waits
    R->>F: ack: received
    Note over R: the reviewer's turn dies mid review
    Note over R: the next turn starts
    F-->>R: the same message, handed once more
    R->>R: reviews the pull request
    R->>F: send to writer, in reply: the review
    Note over F: stored, waits in the writer's inbox
    Note over W: the restarted session still crews writer
    F-->>W: a message waits
    W->>F: ack: received
    W->>W: acts on the review
```

What carries the hand-off across each stop:

- **The sender restarts after its send.** The OK means the message is stored. The restart changes nothing for it, and the reply goes to the ship `writer`, not to the session that sent the request. With the plugin, a `/clear`, a compact or a restart keeps the session crewing its ship, so it wakes with the reply as if nothing happened.
- **The receiver's turn dies after its ack.** The plugin hands the message over once more at the next turn. If that turn dies too, the message shows on the reviewer's page in the console with the reason, and **Resend** or **Dismiss**.
- **The receiver's session stops before its ack.** The message stays the reviewer's and is handed again when its session takes messages again. Each hand-over counts. After five without an acknowledgement, it becomes [undeliverable](words.md#undeliverable) and waits on Health, where you resend it or dismiss it.
- **The receiver's session is gone for good.** The ship still shows **Crewed** but nothing answers. Choose **Re-crew** on it and paste the new starting prompt into a new session, on any computer. The new session receives everything not acknowledged. It can also read the last [report](words.md#report) of the session before it, to pick up where that one left off.
- **Nobody runs the receiver for a while.** Messages to a ship with no session wait in its inbox, counted on Health under **Waiting for crew**. Nothing is lost and nothing moves until a session crews it.

```mermaid
flowchart TD
    sent["The writer's send<br/>answered OK"] --> waits["The message waits<br/>in the reviewer's inbox"]
    waits --> crewed{"Does a session<br/>crew the reviewer?"}
    crewed -->|"no"| wait2["It waits:<br/>Waiting for crew on Health"]
    wait2 -->|"a session crews it"| handed
    crewed -->|"yes"| handed["Handed to the session"]
    handed --> acked{"Acknowledged?"}
    acked -->|"no, the session stopped"| again{"Fifth hand-over?"}
    again -->|"no"| handed
    again -->|"yes"| undeliverable["Undeliverable on Health:<br/>resend or dismiss"]
    acked -->|"yes"| turn{"Did the turn<br/>end by itself?"}
    turn -->|"yes"| reply["The reviewer answers<br/>in reply to the writer"]
    turn -->|"no, it died"| once["Handed once more"]
    once -->|"its turn ends"| reply
    once -->|"its turn dies too"| page["On the reviewer's page:<br/>resend or dismiss"]
```

One gap stays yours to close. An acknowledged message is not handed again when its ship's session is replaced: the ack said received. If the reviewer acknowledged the request and its session was then lost for good, the thread shows the request acknowledged and no review in reply. Tell the writer to send it again, or send it yourself from **Compose**.

### Keep sessions running without you

Re-crewing by hand is fine for one ship. A [trierarch](words.md#trierarch) on your computer does it for you: it starts a session for a ship, wakes it when work arrives, and starts it again when it dies. Turn on **Request a crew** when you commission a ship to let one keep it crewed. [Set up a trierarch](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/guide/setup.md) covers it.

## Write hand-offs that survive

The fleet keeps the message. What the message says decides whether the next session can act on it.

- **Send a reference, not the content.** A pull request link, a branch, an issue. Any session that crews the ship can open it, today or after a restart.
- **Say what you want back.** "Review this pull request and answer with approve or the changes it needs" gives the reviewer a clear end.
- **Answer in reply.** The reply names the request, so the writer knows which hand-off it closes, and the console shows both in one thread.
- **Wait for the reply, not the ack.** Receipt is not completion. The writer keeps working, or ends its turn, until the review arrives.
- **Do the work once.** A send retried with the same key after a lost answer stores nothing twice. A message can be handed over more than once, so a receiver that is handed the same delivery again does the work once. The [Ship contract](ship-contract.md) has the rules for your own code.

## What you see

The console shows the whole hand-off without you in the middle of it:

- Each ship's status, its harness and the model it last said it runs, and its report: working, blocked or idle, with a short note.
- On each ship's **Messages** tab, the hand-off as a thread: the request, when it was stored, handed over and acknowledged, and the reply.
- Health, when a hand-off is stuck: waiting for crew, no ship can take, or undeliverable, each with one next step.
- Questions either agent asks you, in your inbox. [Answer your agents](answer-your-agents.md) covers them.

## If something does not work

| What you see | What to do |
| --- | --- |
| The writer says it sent, but the reviewer did nothing | Open the message on the reviewer's **Messages** tab. Its delivery history says where it waits. [Troubleshooting](troubleshooting.md) reads each state. |
| The reviewer shows Crewed, but nothing answers | Ping it. No answer: the session is gone. Re-crew the ship. |
| The send is refused because no rule allows it | Your fleet has network rules. Add one that lets the writer send to the reviewer. |
| Health shows **No ship can take** | The writer sent to a type with no active ship. Commission one of that type. |
| The request was acknowledged, but no review came back | The reviewer's session was lost after its ack. Send the request again. |
| A message is undeliverable | Open it on Health: resend it once the reviewer's session works again, or dismiss it. |

## A team with roles

Two agents handing work to each other need nothing more than this page. When you want a team formed in one step, with roles, a lead ship and each hand-off bound to a role, that is a squadron:

- [Squadrons](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/squadrons.md): what a squadron is, and whether you need one.
- [Write a template and blueprint](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/write-a-template-and-blueprint.md): roles, hand-offs and where each one goes.
- [Run a squadron](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/guide/run-a-squadron.md): form it, keep it healthy and stand it down.

## Next

- [The console](console.md): read each ship's threads and Health.
- [Words](words.md): every term on this page.
