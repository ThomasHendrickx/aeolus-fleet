# The trierarch starts and talks to a session without a terminal

Design for [#882](https://github.com/ThomasHendrickx/aeolus-fleet/issues/882) and [#1085](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1085), as one design: how the trierarch starts a session and talks to it. New core fleet functionality, so it goes purpose first. The lessons and questions below are for review; nothing past the purpose is decided until Thomas agrees the purpose. No code.

The trierarch lives in its own repository (0049); its docs cited below are in `aeolus-fleet-trierarch`.

## 1. Purpose (to agree)

The trierarch starts each session it crews as a program it talks to through the harness's own API (Claude Code in print mode with streamed JSON or its SDK, `codex exec`), instead of a terminal program in its tmux server that it types into. A session signs in to its model with an API key (Anthropic Console, OpenAI) as well as with a subscription login.

For whom: the person who runs a trierarch on their computer or a server with no screen, and every ship it crews, whose deliveries must reach that ship's session and no other.

The need: tmux is a dependency of every machine, a session can reach the trierarch's tmux server (#880), and a hand-over depends on typed keys and hooks firing (#881). Thomas, 18 Oct: "Must do". For keys, Thomas: "have session use api keys to work."

The outcomes:
1. Each session is handed only its own ship's deliveries, by how it is started, not by care. Restarting every session proves it (the test #881 asked for).
2. A machine needs no tmux, on the host and in containers.
3. A session outlives a trierarch restart or upgrade, and no delivery is lost or handed twice beyond what 0040 allows.
4. The operator sees what a session is doing without attaching to a screen.
5. A session works with an API key; the key never travels through the fleet or a crew request, and the session's model is not shown it.
6. Turn, hand-over, confirmation, force and once more work as 0040 says.

Not the purpose:
- Changing the delivery protocol (0040) or the plugin watcher for sessions a person crews by hand.
- A cloud runtime (#57).
- Spend limits, model governance or placement by cost (#375, the trierarch plugin).

## 2. Lessons to check against

- **0026** (trierarch repo). The trierarch owns wake and liveness for its sessions; a session holds no fleet credential, its calls go over its ship's own socket; each harness is one adapter.
- **0040.** The pushed lease is the one hand-over contract; `handed` names a channel; the hook's `ack` is the agent's confirmation. Rejected: the computer side acking for the agent. Force is best effort; a stopped turn is not handed once more.
- **0039** (trierarch repo). Runtime is a machine choice behind the `SessionRuntime` port (list, stop, start, type, interrupt, screen), tmux inside each container. One long-lived token per machine, in `~/.aeolus/trierarch/model-token`, handed by env file, never a command line (#445). Rejected "for now": a credential proxy on the host, because it was unproven with subscription logins and the vendors' terms were unclear; "the preferred route later if they allow it".
- **0027.** Crew settings carry no paths or flags; a harness declares its options as a JSON Schema. `trierarch.md:203`: no credential travels in a request or the fleet.
- **0013.** Before 1.0.0 breaking changes are allowed; no compatibility layers.
- **#881 (P1).** A delivery for one ship reached another's session after a restart. Thomas: "Tmux mapped ships to sessions correctly throughout. The fault is the leaked environment, not the hand-off by name." Lesson: what a session inherits is the risk, whatever carries the hand-over.
- **#880, #885.** A session could kill every other session (inherited `$TMUX`) and read every ship's crew token. Fixed by contained access (R5); headless must keep it.
- **#479, `trierarch.md:70`.** An upgrade killed every session until the tmux server left the service's cgroup (`KillMode=process`). Sessions must outlive the trierarch.
- **#846, #1016, #890.** Only `Stop` closes a turn; the text must reach the turn before the ack; an unforced delivery waits for an idle turn.
- **#490.** Checks rest on documented, long-term supported signals, never on terminal rendering. #888, #768, #995: screen reads are flaky.
- **`trierarch.md:182`, `:217`.** The screen is read today for prompts that stop a session before its hooks run (trust, login method, bypass warning); Codex refusals are read from its undocumented session log. Headless removes the screen, not the need to see these.
- **`trierarch.md:279`.** Codex runs turns in a daemon that outlives its pane, hence `--no-daemon`: a session must be a process that owns its work.
- **#852.** A refused model login comes back as "no activity" without its cause. An API key that is wrong or out of credit must say so.
- **`trierarch.md:140`, `:79`, #392.** Usage is read as subscription windows; a login's rights decide which models are offered. A key has cost, not windows, and may offer other models.
- **`trierarch.md:186`.** Every hand-over line says no human reads the terminal (#756); nobody watches a session the trierarch starts.

## 3. Questions

Each has options and my pick. They follow once the purpose is agreed.

### H1 How does a session outlive a trierarch restart or upgrade?

Today the tmux server keeps sessions running while the trierarch restarts (#479). A headless session is a process whose input and output the trierarch holds.

1. **A small process per session, started outside the service, holds the session's input and output; the restarted trierarch connects to it again over a socket.** Keeps today's rule that sessions outlive the trierarch.
2. Sessions are the trierarch's children. A restart ends them; each starts again resuming its conversation (`--resume`, `codex resume`), and a handed delivery not yet confirmed goes once more (0040). Simplest, but every upgrade stops every busy turn.
3. Option 2, but an upgrade waits until every session is idle, with a deadline. Fewer stopped turns; upgrades can wait long.

**Pick 1.** Upgrades are frequent and #479 showed what stopping every session costs; the per-session process is also the one thing that holds that ship's input, which is outcome 1.

### H2 How does the operator watch a session?

Today: `tmux attach`, or Remote Control on the host.

1. **The trierarch keeps each session's streamed events on the machine as its transcript, read with a trierarch command, and puts the turn's latest activity in its report details** (0028, 16 KB) so the console shows it.
2. Option 1 without the console line: local only.
3. The console shows the whole live transcript, carried by the fleet. Most visible; new fleet functionality, and transcripts can hold secrets the fleet should not store.

**Pick 1.** Watching stays on the machine, and the console still answers "what is it doing now" without a screen.

### H3 Can the operator still talk to a session directly?

Today the operator can attach and type, which is also a way in for a mistake (#880).

1. **No: the operator talks to a ship by sending it a message; steering a busy turn is a forced delivery** (0040). Remote Control is dropped where the headless harness lacks it.
2. A trierarch command opens the session interactively in the operator's own terminal, with hand-overs paused until it closes.
3. Keep Remote Control on host sessions wherever the harness offers it in headless mode, and option 1 otherwise.

**Pick 1.** The fleet stays the one door to a ship, and no second input path exists to leak; option 2 can follow if a real need shows.

### H4 Does headless replace tmux, and in which runtimes?

1. **Headless replaces tmux on the host and in containers in one release; tmux leaves the machine requirements and the session image** (0013).
2. Headless and tmux both kept, a machine's choice.
3. Host first; containers keep tmux until a later release.

**Pick 1.** Outcome 2 holds only when tmux is gone everywhere, and a second runtime is the compatibility work 0013 rules out.

### H5 What is the agent's confirmation in a headless session?

0040 makes the hook's `ack` the confirmation and rejects the computer side acking for the agent. Claude Code runs its hooks in print mode; Codex in `codex exec` is to be proven.

1. **The plugin's hooks run inside the headless session and confirm, report the turn and handled, as today.** 0040 unchanged; a harness whose hooks do not run headless is not offered headless until they do.
2. The harness API's own event that a turn began with that message is the confirmation, reported by the trierarch. Works without hooks; reopens 0040's rejection.
3. The agent confirms with a fleet call of its own in the turn. Depends on the model doing it.

**Pick 1.** It keeps the promise ending at the agent, as 0040 decided, and needs no new contract.

### H6 Where is an API key kept and who sets it?

1. **On the machine, in the trierarch's configuration beside the model token (mode 600), one login per harness: key or subscription, set by the person who runs the trierarch; which one is stated in its report details** so placement can see it.
2. Option 1, with several named keys per harness and a declared harness option (0027) naming which key a crew request uses.
3. Per fleet, stored on the server and handed to trierarchs. Central, but a credential then travels through the fleet.
4. Per crew request. Same, and against 0027.

**Pick 1.** No credential travels in a request or the fleet; option 2 can follow when one machine must bill two ways.

### H7 How does the key reach the session without being shown?

The model in a session has a shell and can read its own environment, as it can read today's container token.

1. **A credential proxy on the machine holds the key; the session gets only the proxy's address.** 0039 rejected a proxy for subscription logins because the vendors' terms were unclear; API keys are meant for this use, so that reason falls.
2. The key in the session's environment from an env file, as the container token today. Simplest; the session's model can read it.
3. The harness's own key helper (Claude Code `apiKeyHelper`) reading the key file. Off the environment, still readable by the model.

**Pick 1.** It keeps the rule 0026 holds for the crew token, a session holds no secret, and 0039 already named it the preferred route.
