# Fine-grained scopes for 0.27.0 (#348, #600, #866)

Design proposal by designer-2. Part 0 sets the product direction (one organisation, one fleet, one operator, many people, apps and agents) and is open (questions 15 to 31, 19 and 24 dropped; 0.6 for the console; 0.8 fleet access contained by default and 0.9 discovery, questions 37 to 47); the catalogue in part 6 is on hold until it fits. Thomas answered questions 1 to 10 (part 5); questions 11 to 14 are open.

Diagrams in this folder: `1-model-a.png`, `2-model-b.png`, `3-model-c.png`, `4-forced-delivery.png`, `5-squadron-forming.png`, `6-contained-calls.png` (sources in `src/`).

---

## 0. One organisation, one fleet (product direction, before the catalogue)

Thomas (17 Oct): "one organisation where a symbiosis of humans, apps and agents are interconnected in a secure and managed way that removes the current human as the glue and maximises value through fast information flow where humans still gate and steer on the critical points." And: "scope is what a ship can do, network (e.g. done with labels) is where it can do it." The catalogue in part 6 is on hold until it fits this. This part takes no decisions; options and picks are only in its questions (15 onward).

### 0.1 Purpose

One organisation, one fleet, one operator: argo manages the whole fleet. People, apps and agents are all in it, connected. A subfleet (`subfleet=thomas`) is a group of ships a person owns inside one network, not a separate fleet and not isolation. Crossing between people's ships is the normal case. Three things make it safe and fast:

- **The network says where** a ship can act: which ships and apps it reaches.
- **Scopes say what** a ship may do, wherever it acts.
- **People gate and steer** at the critical points: a question or an approval reaches the right person, not one human who carries everything.

Worked scenario:

| | Thomas | Charlotte (PM) | Burak |
| --- | --- | --- | --- |
| Ships | a tech lead ship, his PA | a PRD ship | a tech lead ship |
| Reaches the CRM (an app) | yes | yes | no |
| Reaches | the PRD ship's answers | both tech lead ships | the PRD ship's answers |
| May do | his tech lead forms delivery squadrons (`squadrons:form`) | the PRD ship sends and directs; it holds no `fleet:commission` and no `squadrons:form`, so it cannot start implementation ships | his tech lead forms delivery squadrons |
| Gates | approves what his tech lead starts | approves the PRD | approves what his tech lead starts |

argo (the operator) sets the network, grants scopes, connects the plugins and sees everything. A good outcome: Charlotte's PRD ship directs both tech leads with no human passing messages along; Burak's ships cannot get at the CRM; the PRD ship cannot start ships, it can only ask a tech lead, whose own scopes and whose person decide; each question lands with the person who owns the work.

### 0.2 Scope says what, network says where: taken strictly

Read strictly, a scope is a verb with no object, and every object comes from the network. The network today has one verb: send (0034). Every bound in part 6 re-read as a where:

| Bound in part 6 | Scopes | Is it a where? | Could the network carry it? |
| --- | --- | --- | --- |
| its own ship | `messages:send` (as itself), `messages:receive` | No: it is who the caller is | No, stays identity |
| ships it reaches | `messages:force` | Yes, already the network | Already does |
| ships it commissioned | `fleet:manage`, `labels:assign` | Yes, a where by lineage | Yes, with a manage reach |
| any ship | `fleet:read`, `messages:resend`, `crew:assign` | Yes: the whole fleet | Yes, as a read reach, a resend reach |
| argo any | argo on every bound; `explainReach`, `reachRefusals` | Yes: the whole fleet, by kind | No: the operator manages the whole fleet |
| labels it owns, its own namespace, the fleet's rules | `labels:define`, `scopes:declare`, `fleet:network` | No: ownership of a thing | No, stays ownership |
| crew requests assigned to its ship | `crew:run` | Ownership by assignment | No, stays assignment |
| new ships | `fleet:commission` | Where the new ship lands | Partly: which person's ships it joins |

In the scenario, sending is already carried by the network: CRM reach and the PRD path are send rules. What the network does not carry is **reading**. `fleet:read` shows every ship and every payload, with no rule in the way:

- payloads: `fleet.message`, `fleet.shipMessages`, `fleet.inbox` (argo's), `fleet.follow` and `fleet.events`;
- ship facts: `fleet.list`, `fleet.ship`, `fleet.shipTimeline`, `fleet.shipWay`, report details (0028), labels;
- fleet facts: `fleet.needsAttention`, `overdue`, `noShipCanTake`, `health`, `limits`, `labels`, `clearRequests`.

So Thomas's PA with `fleet:read` reads every message to and from the CRM ship, customer data included, even though Burak's ships may not send to it. The squadrons and trierarch plugin APIs read through the same scope.

### 0.3 Single-operator assumptions: what holds, what breaks

Holds: one operator `argo` with every scope, managing the whole fleet (0002, 0012); risk is the operator's call (0016); argo past every rule (0034); argo connects the plugins and edits the network (0017, 0021, 0030, 0036).

Breaks, because today the operator is the only human in the fleet and so the glue:

| Assumption | Where |
| --- | --- |
| One account, one console session, sign-in takes over; "Better Auth if several human users ever come": Charlotte and Burak have no way in but argo's or the viewer's session | 0012, 0022 |
| Questions go to argo; one operator inbox | 0038, the ship protocol rule 4 |
| Overdue, not handled, undeliverable and no ship can take go to one Needs attention | 0040, 0041, 0042 |
| An unassigned crew request is the operator's to-do; a crashed crew is told to argo | 0029, 0026 |
| Squadrons serves writes to the operator's session alone (`fleet:manage`) | 0017 |
| Labels are argo's or a plugin's; a person's ship cannot label the ships it commissions with that person's group unless it owns the label | 0031, question 5 |
| No rules is all-to-all, reading included once reading follows the network | 0035 |
| Notices and the guide address `operators` and `viewers` | 0023, 0024 |
| An app is no part of the fleet: a session reaches the CRM through its own tools, where no rule applies | 0034 (rules cover sends only) |

### 0.4 Lessons to check against

- **Every caller is a ship** (0012, 0022): a person or an app in the fleet is a ship, never a flag on argo's session; 0022 rejected "one caller with two rights".
- **Scopes on the server, never in the request** (0002); revocation at once.
- **Reach is the containment** (0034): rules select by labels only, never by type; only a label's owner assigns it, so a ship cannot widen its own reach; a refusal says nothing about the rules. The same must hold for reading.
- **Owners declare their group's reach** (0037). A person's group could be such a group.
- **Labels are for selection, reach included** (0031), never for lifecycle, configuration or secrets.
- **Aeolus distributes, not executes** (0001): the receiving ship decides what to do with a request; Aeolus does not follow a request's intent from ship to ship.
- **No policy** (0016): whatever the network and scopes allow is allowed; the operator sets them.
- **Limits are for speed, not policy** (0037): every send is checked; checking every read and every live event is many times more checks.
- **Rules exist only through a plugin** (0035), and no plugin is all-to-all.
- **Questions are a message to one ship** (0038): open until that ship answers.
- **No compatibility layers** (0013); thin designs for a few people.
- **Tenancy** (0007): one fleet stays one tenant; a person is not a tenant.
- **Console logic on the server** (0033): what a person may see is decided on the server.
- **Earlier rounds**: the network design on #260 and #573; questions 5, 12 and 14 here.

### 0.5 Questions for Thomas

15. **How is a person in the fleet?** (changed by 0.6: see there) argo stays the one operator; Charlotte and Burak must sign in to gate and steer.
    Options: (a) each person crews a ship of their own from the console, with their own login and session, holding the scopes argo grants; (b) every person signs in as argo; (c) a person is not in the fleet, their PA ship answers for them.
    Pick: (a). Every caller stays a ship, each person signs in as themselves, and argo stays the operator.
16. **Does reach govern reading as well as sending?**
    Options: (a) no, reading stays fleet-wide; (b) the same rules govern both: whom a ship may send to, it may read; (c) each rule names its verb (send, read), so the scope says what and the rule says where for that verb.
    Pick: (c). Thomas's ships may send to the CRM ship, and the PRD ship to both tech leads, without either reading the other side's every message; (b) cannot say that.
17. **Reading a message: reach to which side?**
    Options: (a) its sender or its recipient; (b) both; (c) its recipient only.
    Pick: (a). A message the PRD ship sends to Thomas's tech lead is part of that tech lead's timeline.
18. **Does a ship outside read reach show at all?**
    Options: (a) not at all; (b) name, type and status only, no timeline, messages, details or labels; (c) everything but payloads.
    Pick: (b). One connected organisation shares one picture of which ships exist and who crews them; no word of work leaks.
19. **Dropped**: who sets the network. The purpose answers it: argo, the one operator, manages the whole fleet; declared rules (0037) stay as they are.
20. **How does a ship belong to a person?** Charlotte owns the PRD ship; a ship Thomas's tech lead starts is Thomas's.
    Options: (a) a label per person, owned by that person's ship, which labels the ships it commissions (0031, question 5); (b) one `subfleet` label argo owns, and commission copies the commissioner's value to the new ship; (c) argo labels every new ship by hand.
    Pick: (b). It keeps Thomas's `subfleet=thomas`, one label for argo's rules to name, and a person's ships stay theirs without argo's work; core copies only a value argo already set on the commissioner.
21. **What does a person see in the console?** (changed by 0.6: see there)
    Options: (a) their read reach: the fleet page, their inbox, Needs attention, health and squadrons for what they may read; (b) everything, as argo; (c) their read reach plus counts for the rest.
    Pick: (a). argo sees everything; a person's console is a reader like any ship (0033).
22. **Who is told about a ship's trouble?** Overdue, not handled, crashed, needs crew go to argo today.
    Options: (a) the person whose ship it is, and argo; (b) argo only; (c) the person only, argo for a ship that belongs to nobody.
    Pick: (a). The person owns the work and argo manages the fleet; both need to know.
23. **Shared plugins.** Squadrons, the trierarch plugin and the networking plugin serve every person.
    Options: (a) they keep fleet-wide reach, as the organisation's own ships, and serve each person only what that person may read (squadrons checks the person's session); (b) one plugin connection per person.
    Pick: (a). One install, one connection (0021); the person's reach bounds what the person gets.
24. **Dropped**: argo past every rule. The purpose answers it: the operator manages the whole fleet, so 0034's exception stays and covers reading too.
25. **How is an app such as the CRM in the fleet?** "Charlotte has access to CRM, as does Thomas but Burak does not" can only be enforced where Aeolus sees the call.
    Options: (a) the app is a ship: its adapter crews it, ships send it requests and it answers, and send rules decide who reaches it; (b) the app stays outside: sessions call it with their own tools, and Aeolus cannot gate it; (c) the app stays outside, and a label tells each session's harness whether to load the app's tools.
    Pick: (a). Every caller is a ship, the network gates it like any ship, and its traffic falls under question 16's read rules. (c) trusts the session, which is what containment must not do.
26. **Who gates?** "Humans still gate and steer on the critical points."
    Options: (a) a ship asks the person it belongs to (question 20), and argo when it belongs to nobody; (b) every question goes to argo, who passes it on; (c) the asker names the person.
    Pick: (a). The person who owns the work answers it, and no human is the glue; 0038 stays a message to one ship, that person's.
27. **Does a request carry its asker's scopes?** The PRD ship cannot commission, but it can ask Thomas's tech lead, which can form a squadron.
    Options: (a) no: the receiving ship acts on its own scopes, and its person gates what it starts; (b) squadrons checks the scopes of the ship that first asked, carried with the message.
    Pick: (a). Aeolus distributes and does not execute (0001); following intent from ship to ship is policy (0016). The gate on Thomas's tech lead is the guard, so the PRD ship directs and Thomas decides.

**Questions 1 to 14 this part could reopen** (answers unchanged until Thomas says so): 5 (labels bound by lineage: question 20 (b) adds a copy at commission), 10 and 13 (the flagship proxies to argo: or to the person the forming ship belongs to, question 26?), 14 (`fleet:manage` bound by lineage: or a manage reach?). Questions 1 and 12 now fit the purpose: argo, the operator, grants and sets reach.

### 0.6 What this means for the console

Thomas (17 Oct): "our questions in console solution is the wrong direction. It can be a plugin or hence just a totally different web app, where a human gets a ship. But it is not core of aeolus ... Same with console taking on every plugin in its UI ... squadrons could perfectly have its own UI running separately, or we do micro front ends." In his direction a human is a ship, reached through whatever app suits them: a separate web app, a plugin, a chat. Core Aeolus is the fleet server and its API, not the human interface. The console's job becomes argo's administration of the fleet. Nothing below is decided; each row is a choice made earlier that needs a second look.

| Part | Today | Under this direction | Touches |
| --- | --- | --- | --- |
| Questions in the inbox | Open questions on top of the operator inbox, the pick preselected, one tap answers (0038); the console's server checks an answer and sends it through `fleet.reply` | Move to a plugin or a separate app where a person's ship answers its questions; leave argo's admin console | `lib/questions.ts`, `question-answer.ts`, `questions-actions.ts`, `features/inbox`; #512, #849, #854, #869, #870 |
| Question content types | `application/vnd.aeolus.question+json`, answer, withdrawal, replacement; core never reads them, but the ship protocol text it serves teaches them and names argo as the one who answers (0038, rule 5) | Keep as a fleet convention any app can answer, or move into the app that owns them (question 29) | `packages/core/src/adapters/trpc/ship-protocol.ts`, `plugins/aeolus/scripts/aeolus-ask.sh`, `packages/common` |
| Ship protocol rule 4 | "A question only the operator can answer goes to argo" | Goes to the person the ship belongs to (question 26); the protocol text changes | `ship-protocol.ts`, the aeolus plugin skills |
| Operator inbox | argo's messages, read, done, reply, compose (0012: "Messages to argo are the operator inbox") | Keep as argo's inbox, the admin's; people's inboxes live in their own app | `app/(console)/inbox`, `features/inbox`, `features/compose`, `lib/inbox*.ts`; #849, #863 |
| Needs attention | Undeliverable, not handled (Resend, Dismiss), overdue, no ship can take, as the operator's to-do (0040, 0041, 0042) | Keep as argo's view of the fleet's state; telling a person about their ship moves to that ship's messages (question 22) | `app/(console)/needs-attention`, `lib/needs-attention.ts`; #789, #799, #845 |
| Fleet health | Stuck deliveries by cause and place, the trend (0041, 0042) | Keep: fleet administration | `app/(console)/fleet-health`, `features/health`; #304, #864, #865, #867, #868 |
| Needs crew | An unassigned crew request is the operator's to-do, with a starting prompt (0029) | Keep: fleet administration | `app/(console)/needs-crew`, `features/needs-crew` |
| Fleet, ship, labels pages and ship actions | List, ship page, timeline, commission, release, retire, ping, labels | Keep: fleet administration | `features/fleet`, `features/ship`, `features/ship-actions`, `features/labels` |
| Squadrons pages | The console's server calls squadrons' API with the console session cookie (0017); catalogue, forming, members, messages | Squadrons' own UI, run separately, or a micro frontend in the console (question 30) | `app/(console)/squadrons/**`, `features/squadrons`, `lib/squadrons-*.ts`, `lib/forming-members.ts`; `packages/squadrons` |
| Trierarchs (machines) pages | The console reads machines from the trierarch plugin (0030), silent machines flagged | As squadrons (question 30) | `app/(console)/trierarchs/**`, `features/trierarchs`, `lib/trierarch-plugin-*.ts`, `lib/machines.ts`; `packages/trierarch-plugin` |
| Network page | argo edits the rules held by the networking plugin (0036), sees declared rules apart (0037), and the reach graph from `fleet.explainReach` (0034) | Rule editing to the networking plugin's own UI (question 30); the reach graph and refusals, which are core's, stay | `app/(console)/network`, `features/network`, `lib/networking-plugin-*.ts`, `lib/network-rules.ts`; `packages/networking-plugin` |
| Connect | Settings: the web app's server commissions the plugin's ship and hands its secret to the plugin server to server (0017, 0030, 0036) | Keep as an admin action (commissioning a ship with scopes is argo's), or move into each plugin's own setup | `features/settings`, `lib/connect-plugin.ts` |
| Plugin presence in the console | Navigation, health and version checks per plugin; which plugins are on reaches the browser only as what a page shows (0033) | Shrinks to links when plugin UIs run apart | `lib/plugin-nav.ts`, `lib/plugin-ships.ts`, `lib/startup-warnings.ts`; #432, #454, #502, #503 |
| `console.session` | Another service checks a console session from the forwarded cookie (0012, 0022); squadrons serves writes to `fleet:manage` | Stays the way a plugin UI checks argo; a person's app signs in as the person's ship instead (question 15) | `packages/core/src/adapters/trpc/console.ts`, `packages/squadrons/src/adapters/trpc/router.ts` |
| Notices | The installation sets notices for `everyone`, `operators` or `viewers` (0023) | Keep for the admin console; a person's app shows its own | `features/notices`; installation procedures |
| Guide | The installation sets one guide per audience (0024) | Keep for the admin console | `features/guide`, `lib/guide.ts`; #690, #721 |
| Viewer | Read-only sessions of the whole fleet, argo's inbox included (0022) | Keep as a read-only look at the admin console (the hosted demo) | `features/sign-in`, `lib/session.ts` |
| Sign-in | argo's email and password, or a hosted one-time ticket (0012, 0020) | Keep for argo; people sign in to their own app | `app/sign-in`, `lib/hosted-sign-in.ts` |
| Analytics | Off by default, a closed list of console events (0025) | Keep | `lib/analytics*.ts` |

**Questions 15, 21, 22 and 26 against this:**

- 15 changes: a person's ship is crewed through an app outside core (a separate web app, a plugin, a chat), holding that ship's crew token as any crew does (0015), not through a console login. argo keeps the console's login.
- 21 changes: the console is argo's; what a person sees is what their own app shows of their ship's read reach. The question moves to that app, and for core reduces to question 16.
- 22 holds, with one change: a person is told by a message to their ship, which their app shows, not by an entry in the console's Needs attention. argo keeps Needs attention.
- 26 holds: the person the asking ship belongs to answers, in whichever app crews their ship; question 29 decides what the question looks like.

**Questions this table forces:**

28. **Does core keep any human-facing surface beyond argo's administration?**
    Options: (a) no: core is the fleet server, its API and argo's admin console; people reach the fleet through apps outside core; (b) core's console also gives each person a page for their own ship; (c) the admin console leaves core too, as one more app on the API.
    Pick: (a). It is Thomas's direction, and the console still needs an admin home for argo; (c) can follow if the console ever becomes just an API client.
29. **Does the question content type stay a core convention?** Core never reads it (0038), but the protocol text core serves teaches it.
    Options: (a) it stays a fleet convention in the ship protocol, answered by any app; (b) it moves wholly into the app that answers questions, which teaches its own shape; (c) it goes: a question is a plain message.
    Pick: (a). Ships of every harness and apps of every kind need one shape to ask and answer; it costs core only protocol text.
30. **Plugin UIs: apart or inside?**
    Options: (a) each plugin serves its own UI, the console links to it, and the UI checks argo with `console.session`; (b) micro frontends inside the console; (c) as today, the console renders every plugin.
    Pick: (a). Each plugin ships and releases its UI with itself, and the console needs no contract for hosting others; micro frontends add that contract for one shared frame.
31. **What happens to the work on the console's questions now?** #849 (operator inbox and questions redesign) is open.
    Options: (a) hold it until questions 28 and 29 are answered; (b) finish it for argo's inbox only; (c) close it.
    Pick: (a). Building more of a surface that may move out of core is the cost this direction warns about.

### 0.8 Fleet access contained by default

Thomas (17 Oct): "I see benefits from containing aeolus access by default. The agent if ran by trierarch does not need the token." In his direction a session the trierarch crews holds no fleet credential. Its fleet calls go through the trierarch on its machine, which holds the crew token, so a container needs no route to the fleet. A session crewed by hand, or a chat with the fleet's connector, keeps its crew token as today (0015). Nothing below is decided.

**Why it contains.** Today a container holds its ship's crew token in its home (0039: "its own home (the harness's config folder, the aeolus plugin, its ship's identity file)"). A breached session can copy that token out and act as its ship from anywhere until the lease ends, past the end of the session and from outside the network's view of where the ship runs. Without the token, the session acts as its ship only while it runs, only from its container, and only through the trierarch; a release, which stops the session (0026), ends that too. What its ship may do does not change: scopes stay on the server (0002) and reach stays the network's (0034).

**Today, read in the code:**

- `plugins/aeolus/scripts/aeolus-fleet.sh` is the one door for a session's fleet calls: it reads the crew token from the folder's identity file and calls the fleet's REST API with curl, the token as the bearer. Every hook and every model call goes through it.
- The trierarch registers with the secret on the host (0026) and writes the identity, crew token included, through the host's aeolus plugin into the ship's home, `~/.aeolus/trierarch/homes/<shipId>` (`claude-code-home.ts`), mounted as the container's home (`container.ts`).
- The trierarch's hand-over already runs on the host: it runs the host's `aeolus-push.sh hand` and `died` against that home (`plugin-identity.ts`), so push receive and handed are the host's calls today, with the token read on the host.
- The container runs on the runtime's default network (`container.ts` names no network), so it reaches anything, the fleet included.

**The calls that move** (the ones a session makes from inside its container):

| Call | Made by | Moves to the trierarch |
| --- | --- | --- |
| `ack` | the PreToolUse and Stop hooks, confirming a hand-over (0040) | yes |
| `turn`, `handled`, `notHandled` | the hooks (0040) | yes |
| `send`, `report`, `inbox`, `whoami`, `reportLog`, `pong` | the model, through the plugin's scripts and skills, `aeolus-ask.sh` included | yes |
| `protocol` (the fleet's OpenAPI text) | the model, at the start of crewing | yes |
| a `fleet.*` procedure its scopes allow (an orchestrator ship with fleet scopes) | the model | question 38 |
| `pushReceive`, `handed` | the trierarch, already on the host | no change |
| `register` | the trierarch, already on the host | no change |
| `deregister` | the model | question 38 |

**How it would work.** The identity a trierarch writes for a session holds no crew token; it names the trierarch instead. `aeolus-fleet.sh` sends the same REST call to the trierarch over a Unix socket in a folder mounted into the container (curl's `--unix-socket`), with no bearer. The trierarch knows the ship by the socket the call came in on, one per ship, adds that ship's crew token and forwards the call to the fleet unchanged, then hands back the fleet's answer unchanged: status, code and body. The crew token stays in the trierarch's own state on the host, never in the ship's home. Diagram `6-contained-calls.png`.

![Contained fleet calls](6-contained-calls.png)

**What the trierarch adds or checks on the way.** Deterministic only, nothing that reads content: 0026 rejected an AI dispatcher, and the trierarch is a plain process. It adds the bearer. It checks that the path is one of the fleet's API (question 38) and that the body fits the payload limit plus its envelope (0006), refusing anything else itself with a fixed code that says the trierarch refused it. It logs one line per call (ship, path, status), never a body. The fleet still authorises every call by the ship's scopes and the network rules; the trierarch duplicates none of that. **Content moderation stays out of the trierarch.** If it is ever wanted, it is a server-side plugin hook that every ship's sends pass through, crewed by hand or not, never a check on one machine that a hand-crewed session skips.

**The delivery guarantee.** A send is OK only once the server stored it, and the trierarch never answers OK itself: it holds no queue and buffers nothing, so the answer the session gets is the fleet's. The idempotency key goes through unchanged, so the plugin's busy retries keep their meaning. While the trierarch is down or restarting, a call gets no answer, exactly as when the fleet does not answer (`aeolus-fleet.sh` exit 6), and nothing is stored. A send whose answer was lost between the fleet and the trierarch is sent again with its key, as today.

**How the turn and the hand-over keep working.** They do not change. The trierarch already types the hand-over line; the hooks' `ack`, `turn`, `handled` and `notHandled` reach the fleet through the socket, so the agent still confirms its own message (0040 rejected the computer side acking for the agent). LEASE_ENDED comes back as the fleet answered it, and the plugin forgets the ship as today. A ship crewed again gets a new crew token in the trierarch's state while the socket stays the same, which takes the place of the plugin's "crewed again during the call" retry for these sessions.

**What a session crewed by hand or a chat keeps.** Its crew token, held as today: in the folder's identity file for a hand-crewed session with the aeolus plugin, in the conversation for the connector (0015). Nothing stands between it and the fleet, so it gains none of this containment. The plugin keeps both paths: the identity names either a crew token or the trierarch's socket.

**Egress.** With no fleet route needed, a container's egress could be narrowed. But the model API and git are not all a session reaches today: the published image runs a repository's tests, npm installs and Testcontainers through Podman inside the container (0039), so it pulls packages and images. Rootless Podman's default network has no allowlist by name, so narrowing takes an egress proxy or firewall rules per container, and a list per repository. That is a cost of its own (question 41).

**Cost.**

- The trierarch gains a small server, one socket per ship, opened before the session starts and closed on release, and the crew tokens move into its own state.
- The plugin gains a socket branch in `aeolus-fleet.sh` and in the identity it writes, and `aeolus-push.sh` and the hooks read the identity through it as now.
- The container gains one mounted folder.
- Each call takes one more local hop, a few milliseconds.
- docs/trierarch.md (Session runtime) and 0039's "What it sees" change.
- 0039 rejected "a credential proxy on the host, for now". That was the model login, on subscription terms that are unclear; the fleet is Aeolus's own API, so that reason does not carry over.

**Questions:**

37. **Which sessions hold no fleet credential?**
    Options: (a) every session a trierarch crews, on the host or in a container; (b) only container sessions; (c) a machine's choice in its configuration.
    Pick: (a). Thomas says "the agent if ran by trierarch does not need the token": one way for every session a trierarch crews. On the host a session runs as the trierarch's own user and could read its state, so only a container contains; the host still gains that no token lies in the session's folder.
38. **What does the trierarch forward?**
    Options: (a) any call to the fleet's API (ship and `fleet.*` procedures), except `register` and `deregister`, the fleet authorising each by the ship's scopes; (b) only the calls the aeolus plugin makes; (c) any call, `deregister` included.
    Pick: (a). Scopes stay the server's (0002), so the trierarch does not re-decide them, and a ship with fleet scopes keeps them. `deregister` would end a crew the crew request keeps (0026): release is removing the request.
39. **What does the trierarch add or check?**
    Options: (a) the bearer, the path (question 38), the body size, and one log line without the body; (b) (a) plus a rate limit per session; (c) (a) plus checks of the content.
    Pick: (a). (b) is policy (0016) where the fleet already has limits for speed; (c) is the AI or content judgement 0026 rejected, and moderation, if ever wanted, is a server-side plugin hook for every ship.
40. **How does a session reach the trierarch?**
    Options: (a) a Unix socket in a folder of its ship's own, mounted into the container, the ship known by the socket; (b) a port on the host the container reaches, with a secret per ship in the container; (c) the trierarch reads requests from files in the ship's home.
    Pick: (a). The socket names the ship by where it is, so no secret goes back into the container. A mounted folder, not a mounted socket file, survives the trierarch opening the socket again after a restart.
41. **Is the container's egress narrowed now?**
    Options: (a) not in this step: the fleet credential goes, and narrowing egress is a later machine configuration with a list per repository; (b) narrow now to the model API, the repository's git remote and the registries a repository's configuration names; (c) no egress at all, everything through a proxy on the host.
    Pick: (a). Taking the token out stops a breached session acting as its ship from elsewhere, at the cost of a socket. Narrowing egress guards against data leaving, needs a proxy and a list per repository, and breaks tests that pull images until the list is right.
42. **What happens while the trierarch is down?**
    Options: (a) a call gets no answer, as when the fleet is down, and the session goes on; nothing is queued; (b) the trierarch queues sends and answers OK.
    Pick: (a). (b) answers OK before the server stored the message, which breaks the promise.

### 0.9 Discovery

Thomas (17 Oct): "I would like to add a discovery tool for ships. Now we are using networking, asking aeolus who is on the network and is accessible should be a normal call to make. Like a discovery call on an IP network." In his direction any ship asks the fleet which ships it can reach right now, as a normal call. Nothing below is decided.

**Today:**

- A ship sees other ships only with `fleet:read`, which shows every ship, timeline and payload with no rule in the way (the gap in 0.2).
- Only argo asks whom a ship reaches (`fleet.explainReach`, 0034), answered with the ships, never the rules or why, and recorded nowhere.
- A ship without `fleet:read` learns of others only from the messages it gets, its starting prompt, or a squadron's hand-offs (0017); or by sending and being refused (`NOT_REACHABLE`, one fixed message, each refusal recorded for argo).
- What a ship carries that could say what it is for:
  - its name;
  - its type, a free text;
  - the optional note the commissioner gives at commission (blueprint: "name, type, optional note"; `Ship.note`);
  - its crew's report: state, note and details, kept with the lease, not the ship (0028).

  No ship carries a description of what it offers, and nothing states the content types a ship answers.

**How it would work.** A ship procedure, beside `whoami`, that every ship with `messages:send` may call. It answers with the ships the caller can send to now, checked as a send would be at that moment, the same matching `fleet.explainReach` uses (0034):

- the rules in force, or all-to-all with none;
- argo always, since every ship sends to argo;
- never a retired ship, never the viewer ship.

It answers too the types the caller can send to now, each with how many of its ships it reaches. As with explainReach, it answers the ships, never the rules or why, and records nothing. A refusal stays as 0034 has it: one fixed message, no reasons.

**What it touches:**

| Question | How discovery relates |
| --- | --- |
| 16 (does reach govern reading?) | Discovery answers send reach: who will take my message. If 16 picks (c), read reach is a second set, answered by the read procedures, not by discovery (question 46) |
| 17 (reading a message, which side) | Untouched: discovery shows ships, never messages |
| 18 (what shows outside read reach) | Discovery shows of each ship what 18 shows outside read reach, so it never shows more than reading would (question 44). If 18 picks (a), not at all, discovery is the one way a ship learns that another exists |
| 25 (an app as a ship) | With 25 (a), the CRM is a ship. Charlotte's PRD ship discovers it with its note; Burak's ships do not, since no rule lets them send to it. Discovery is how a ship finds the apps it may use, with no list kept in a prompt |
| 0034 (a refusal says nothing about the rules) | Holds. A ship learns the set it reaches, which it could learn by sending; it learns no rule and no reason. Unlike probing by sending, discovery leaves no refusal record for argo (question 45) |
| Squadrons' hand-offs (0017) | Unchanged: a role still names its hand-offs; discovery adds a way to find ships outside them |
| REST and MCP | The call maps onto the one tRPC procedure, as every ship call does (0004), so a chat with the connector discovers too |

**Cost.** One reach check over the fleet's ships per call; core already does this check for argo's explainReach. With rules set, the cost grows with the ships and rules; limits are for speed (0037), so a call may be capped like the other reads. Common gains the answer's schema; the plugin and the protocol text gain a line on the call.

**Questions:**

43. **Who may discover?**
    Options: (a) every ship with `messages:send`, no new scope; (b) a scope of its own; (c) every crewed ship, `messages:send` or not.
    Pick: (a). Knowing whom a send can reach is part of sending, as Thomas puts it "a normal call"; a ship that cannot send reaches no one.
44. **What does it show of each ship?**
    Options: (a) name, type and status (awaiting crew, crewed), and its description (question 47); (b) (a) plus its labels; (c) (a) plus its crew's report.
    Pick: (a). It matches what question 18 (b) shows outside read reach, so discovery never shows more than reading would. Labels are what the rules select on, so showing them beside the reach set maps the rules (0034); the report is work, which read reach governs (question 16).
45. **Is a discovery call recorded?**
    Options: (a) no, as explainReach records nothing; (b) each call recorded for argo, beside reach refusals.
    Pick: (a). It reveals nothing a send would not, and recording every normal call buries the refusals argo reads.
46. **Discovery and read reach.**
    Options: (a) discovery answers send reach only; (b) it answers both, marking per ship whether the caller may send, read or both.
    Pick: (a). It answers Thomas's question, who is on the network and accessible, in one set. A second verb in its answer waits for question 16.
47. **Can a ship say what it offers?** Today only the commissioner's note, the type and the crew's report say anything.
    Options: (a) the commission note is the description: whoever commissions the ship (argo, a squadron template, a tech lead) writes what it is for, and discovery shows it; (b) the crew states what its ship offers, kept with the lease as the report is, so an app's adapter can name the content types it answers; (c) a description on the ship, which the commissioner and argo may change at any time; (d) nothing beyond the type's name.
    Pick: (a). It needs no new field, and the one who decided the ship should exist knows what it is for; the receiving ship still decides what to do with any request (0001). (b) fits an app such as the CRM better, but is a second free text kept on every lease.

---

## 1. Purpose

**What scopes are for.** A scope is the one way Aeolus says what a ship may do. Every caller is a ship (0012); the server reads its scopes, never the request (0002). Aeolus adds no policy of its own (0016): whatever a scope allows is allowed. So the scopes are the operator's only lever on risk, and they have to be fine enough that the operator never has to give a ship more than it needs.

**Who holds them.**

| Holder | Needs | Must never get |
| --- | --- | --- |
| argo (operator) | everything | |
| viewer | read | any write |
| plugins (squadrons, trierarch plugin, networking plugin) | the fleet actions their job needs, on the ships they run | reach or control over ships that are not theirs |
| trierarch ships | crew the ships assigned to them | crew any other ship |
| orchestrator ships (orchestrator-1, a tech lead) | send, and, when argo grants it: force a message into a running session, form and stand down squadrons | the operator's powers |
| agent ships, squadron members | send and receive | anything else by default |

**A good outcome for 0.27.0.**

1. argo can give orchestrator-1 the right to force a message into a running session without giving it anything else (#866), and take it back.
2. A label owner cannot widen reach to ships that are not its own (#600).
3. A tech lead ship can form and stand down a delivery squadron, under a scope argo granted, without holding `fleet:manage` itself (#348).
4. No scope can be used to create a scope its holder does not have.
5. Little new surface: a one-user product pays for every concept forever.

---

## 2. Today

### The scopes

Nine, one list: `SCOPES` in `packages/common/src/fleet/index.ts:10`; the seven commission may add are `FLEET_SCOPES` (line 23). Stored on the ship (`ships.scopes`), returned with the crew token lookup, never changed after commission (0002).

| Scope | What it allows (where) |
| --- | --- |
| `messages:send`, `messages:receive` | every agent ship; send, receive, ack (`packages/core/src/adapters/trpc/ship.ts`) |
| `fleet:read` | list, ship, timeline, messages, labels, health, follow, events (`fleet.ts`) |
| `fleet:manage` | commission (with any fleet scopes), rename, release, re-crew, retire any ship, ping, resend, dismiss, crew requests, clear worktree |
| `crew:assign` | assign crew requests, explain why none fits (0029) |
| `crew:run` | only for requests assigned to its ship: starting prompt, release, status, give back, clear requests (0029, 0032) |
| `labels:define` | define, change, delete its labels; declare network rules on them (0031, 0037) |
| `labels:assign` | assign and unassign the values of labels it owns, **on any ship** (0031) |
| `fleet:network` | register as networking plugin, set rules (only the registered one), read declared rules (0034, 0035, 0037) |

Beside scopes, a few calls are argo's by kind, not by scope: `explainReach` and `reachRefusals` (`NOT_THE_OPERATOR_SHIP` in `packages/core/src/domain/registry/explain-reach.ts:39`, `read-reach-refusals.ts:19`).

### Who gets them, and how

| Ship | Scopes | Given by |
| --- | --- | --- |
| argo | all nine | fleet creation (`found-fleet.ts`, `initialise-fleet.ts`) |
| viewer | `fleet:read` | installation (0022) |
| agent ship | send, receive, plus any fleet scope ticked | Commission dialog (`packages/console/features/fleet/ui/organisms/commission-dialog.tsx:66`, all seven offered flat) or `fleet.commission` by any `fleet:manage` ship |
| squadrons | `fleet:read`, `fleet:manage`, `labels:define`, `labels:assign` | console Connect (`packages/console/lib/connect-plugin.ts:19`) |
| trierarch plugin | `fleet:read`, `fleet:manage`, `crew:assign`, `labels:define`, `labels:assign` | console Connect (`connect-plugin.ts:22`) |
| networking plugin | `fleet:read`, `fleet:network` | console Connect (`connect-plugin.ts:25`) |
| trierarch ship | `crew:run` | trierarch plugin (`packages/trierarch-plugin/src/core/machines/join-machine.ts:12`) |
| flagship, squadron member | send, receive | squadrons at form |

### Where they are checked

- At the API door, before any use case: `scopedProcedure`, `anyScopeProcedure`, `scopedCrewProcedure`, `scopedCrewCallerProcedure` in `packages/core/src/adapters/trpc/trpc.ts:414-470`, one per procedure in `fleet.ts` and `ship.ts`.
- In the domain, the finer rules: label owner (`assign-label.ts`, `unassign-label.ts`), networking plugin owner (`set-network-rules.ts`), crew requests assigned to the caller (`crew:run` use cases), argo only (above).
- In squadrons: the console session's scopes from `console.session` (`packages/squadrons/src/adapters/trpc/router.ts:101`, `fleet:manage` for every write), and its own ship's scopes at connect (`packages/squadrons/src/core/management/connect.ts:13`, `label-squadrons.ts:66`).
- In the console: writes removed for a session without the scope (`packages/console/lib/access.ts`).

### The gaps the three issues expose

| # | Gap | Issue |
| --- | --- | --- |
| G1 | A ship can grant a scope it does not hold. Any `fleet:manage` ship commissions a ship with any fleet scope (`commission-ship.ts:55`, "any caller with fleet:manage may give them"): squadrons could commission a `fleet:network` or `crew:run` ship. A scope widens itself. | all three |
| G2 | Scopes never change after commission. Giving orchestrator-1 one new right means retiring it and commissioning a new ship; taking one back the same. | #866, #348 |
| G3 | A label owner assigns its labels on any ship, and declares rules on them (0037): it can pull any ship into its reach. | #600 |
| G4 | No ship can form a squadron: squadrons' API takes only a console session, and forming needs `fleet:manage`, so only the operator forms. | #348 |
| G5 | No forced delivery: the computer side hands a message over only while the turn is idle (0040; `docs/trierarch.md` "inbox watch"; `plugins/aeolus/README.md` "The hand-over"). | #866 |
| G6 | `fleet:manage` is coarse: a plugin may release or retire any ship, not only its own. Accepted for squadrons in 0017. Reported, not in scope. | (none) |

---

## 3. Lessons to check against

**Decisions.**

- 0001, 0040: Aeolus distributes, not executes; the promise ends at the agent's confirmation. Forced delivery may change *when* the message is handed over, never what the agent does with it, and never weaken exactly once.
- 0002: scopes live on the server, are never carried by the ship, and the crew token lookup returns them in one query. Keep that: any change of scopes takes effect at the next call.
- 0010: no heartbeats; a forced delivery must not need one.
- 0012: argo holds every scope and is the operator; the only human authority.
- 0016: no policy. Limits on forming (#348 Q2) are configuration, as fleet limits are (0020), never a hidden guard.
- 0017, 0030: Aeolus knows nothing about squadrons. A `squadrons:form` that core understands would break this; core may store and show it, never interpret it.
- 0031, 0037: ownership is the existing safety idea (a label's owner alone assigns it; declared rules only on owned labels). Reuse ownership rather than invent a second idea.
- 0034: reach is checked at send time and is the containment for a rogue ship. A forced send must still pass reach.
- 0013: no compatibility layers; existing ships may be re-granted by argo once.

**Security.**

- Least privilege: argo grants exactly what a ship needs; plugins get only what their job needs.
- A scope never widens itself: a ship may grant only scopes it holds (or, for a plugin's own scope, that it declared). Fixes G1.
- Granting needs its own authority: changing a live ship's scopes is argo's, so a compromised plugin cannot raise itself or its ships.
- Revocation is immediate, as release is today.
- No secret in a message: a ship-formed squadron is crewed by crew requests, never by crew lines carried in a payload (any `fleet:read` ship reads payloads).

**Cost.** One user, one operator. Every new concept shows in the console, the docs, the plugin and the tests. Prefer: few new scopes, one rule that covers many cases, nothing a role table or resource grammar would add unless a real case needs it.

---

## 4. Models

All three share two things: the send carries `force`, and a ship-formed squadron is asked of squadrons by a message (diagram 5), since tRPC stays core's only door and squadrons already is a ship that receives. They differ in what a scope *is*.

### Model A: few new scopes, bounded by ownership (diagram `1-model-a.png`)

Scopes stay verbs. Add only what the issues need, and let the existing idea of ownership bound them.

- **Forced delivery:** a new core scope `messages:force`. Without it a send with `force` is refused FORBIDDEN, nothing stored. With it, reach still applies. A forced message is handed over at once: a busy turn is stopped first (question 3).
- **Labels:** `labels:assign` narrows to the owner's own ship and the ships it commissioned (core already stores the commissioning ship). Squadrons labels only ships it commissioned and itself; the trierarch plugin only trierarch ships it commissioned and itself; argo keeps any ship, as it commissioned none but holds the fleet. A plugin can no longer pull another ship into its reach.
- **Squadron forming:** squadrons declares its namespace `squadrons` and the scopes in it (part 6). Core stores them on ships and shows them; only squadrons interprets them, reading the sender's scopes with `fleet.ship`. The squadron belongs to the ship that formed it: only it or argo stands it down. A blueprint names the scopes each template's ships get, squadrons' own included, so a member may form in turn when its blueprint says so (question 8). The flagship is the forming ship's one contact with the squadron (question 10).
- **Grant and revoke:** argo grants and revokes any scope on a live ship (one event, effective at the next call). At commission, a ship grants only scopes it holds; a plugin may also grant the scopes of its own namespace. Fixes G1, G2.
- **Console:** the ship page lists scopes with the words already used in the Commission dialog, plus an Edit scopes action for argo; a plugin's scopes listed under its namespace and the plugin that declared it. A forced message is marked forced in the timeline.

### Model B: resource-scoped scopes (diagram `2-model-b.png`)

A scope names its object: `labels:assign:squadron`, `messages:force:type=coder`, `squadrons:form:delivery@3`.

- **Forced delivery:** force allowed only to the ships or types named.
- **Labels:** assign only the keys named, but on any ship: the #600 spam stays possible within those keys unless the resource also names ships.
- **Squadron forming:** per blueprint.
- **Grant and revoke:** argo grants scope plus resource; resources may name things that do not exist yet (a key before it is defined, a blueprint before it is tagged).
- **Console:** a scope editor with a small grammar per scope.
- Cost: a grammar in common, matching in every check, every plugin connect writing resource strings. Precise, but more than any case today asks for.

### Model C: roles that bundle scopes (diagram `3-model-c.png`)

Core holds named sets of scopes (operator, plugin, orchestrator, agent, trierarch); a ship gets a role; argo edits roles.

- **Forced delivery:** the orchestrator role holds `messages:force`.
- **Labels:** a role does not narrow *which* ships: the #600 spam stays.
- **Squadron forming:** the orchestrator role holds it.
- **Grant and revoke:** edit the role (every ship of it changes) or move a ship to another role.
- **Console:** a roles page plus a role on each ship.
- Cost: a second concept beside scopes, and a role is a new word the fleet does not have. Solves nothing scopes alone do not.

### Pick: Model A

It answers all three issues with one new core scope, one narrowing that reuses ownership, and one generic way for a plugin's own scope to live on a ship. It fixes G1 and G2, which the other models need too. B can come later for one scope if a real case needs a resource; C solves nothing here.

### The backbone flows of the pick

**Forced delivery** (`4-forced-delivery.png`). Happy path: the sender holds `messages:force`, reach allows, the message is stored before OK. The computer side takes it with a push receive, forced deliveries first (question 4).

- Turn idle: handed over as today; the prompt the line starts confirms it.
- Turn busy, trierarch session (Claude Code or Codex): the trierarch sends the session its interrupt key, so the turn stops; it marks the turn idle itself, as it stopped it; then hands the message over with its number and types the line as a new prompt, which confirms it (question 3).
- Turn busy, hand-crewed session: the watcher has no hold on the terminal and cannot stop a turn, so the hooks confirm at the next tool call (PreToolUse acks, then denies that call with the message as its reason) or at Stop, as a mid-turn hand-over does today. This is the most a hand-crewed session allows.

Unhappy paths: no scope (FORBIDDEN, nothing stored, key unused); reach refuses (NOT_REACHABLE, recorded); a pull ship (force changes nothing, its next receive gets it); the interrupt does not stop the turn within 10 seconds (the line is typed anyway, queued, and the next tool call confirms it); ack refused or unanswered (stays received, handed again with the next number); the session dies (handed again, then once more and not handled, as 0040 says); compaction (the store survives, the next prompt or tool call confirms, exactly once); lease ends (back to pending, attempts kept). A forced delivery runs on the 10 minute clock, busy or not. What happens to the message the stopped turn was working on is question 11.

**Squadron forming by a ship** (`5-squadron-forming.png`). The forming ship sends squadrons' ship `application/vnd.aeolus.squadron.form+json` (blueprint, parameters, idempotency key); the fleet stores it as any message, under reach. Squadrons acks, reads the sender's scopes with `fleet.ship`, checks its limits (configuration, unset is none, question 9) and the blueprint, commissions the flagship and members with the scopes each template names (question 8), writes labels, declared rules and a crew request per member, and answers with the squadron id and the flagship's name. Unhappy paths: no `squadrons:form`; a limit reached; a blueprint that is invalid or names a scope squadrons cannot grant (refused before anything is commissioned, as the existing template checks); a repeat of a key (the first answer again); squadrons off or not connected (the message waits, as any delivery). No secret travels in a message.

**How the flagship proxies (question 10).** After forming, the flagship is the forming ship's one contact with its squadron, and the forming ship is the squadron's one contact outside it.

1. Squadrons keeps with each squadron its forming ship: argo for a squadron formed from the console, otherwise the sender of the form request as the fleet gives it, never a name in the payload.
2. A member never sends to the forming ship. It sends its flagship `application/vnd.aeolus.squadron.relay+json` with its payload. The flagship acks it and sends the forming ship a new message of the same content type: the squadron, the member's ship name and role, the member's message id, and the payload. A payload that does not fit 64 KB with that envelope is refused by the flagship in a reply, asking for a reference.
3. The forming ship answers a relay with a reply to it; the flagship sends that answer to the member as a reply to the member's message. The forming ship may also send the flagship a relay naming a member or a role; the flagship sends it on to that member, or to one ship of the role.
4. What a flagship tells argo today about its squadron (a member late or silent, standing down, stood down) goes to the forming ship instead. For a squadron argo formed nothing changes.
5. Stand down, add member and remove member: the forming ship sends them to the flagship (`squadron.stand-down+json`, `squadron.add-member+json`, `squadron.remove-member+json`); the flagship refuses them from any ship but the forming ship and argo. The operator keeps every action in the console.
6. Reach: flagship and argo always reach each other (0034). Between a flagship and a forming ship that is not argo, see question 12. A forming ship that is retired: question 13.

---

## 5. Decisions and open questions

Questions 1 to 10 carry Thomas's answer as the decision.

1. **argo changes a live ship's scopes.** Decided: (a) argo grants and revokes on a live ship, effective at the next call, with an event. Carried by `scopes:grant` (part 6).
2. **A ship grants only the scopes it holds.** Decided: (a) subset rule; a plugin may also grant the scopes of its own namespace; the trierarch plugin gets `crew:run` itself.
3. **How a forced message enters a busy turn.** Decided: (b) "it is force, it means it needs to act NOW": the trierarch stops the turn, then hands the message over as a new prompt. A hand-crewed session, which nothing can stop from outside, gets it at the next tool call or Stop. Flow above.
4. **Forced before older messages.** Decided: (a) forced first.
5. **`labels:assign` bound.** Decided: (a) the owner's own ship and the ships it commissioned; argo unbounded.
6. **Where plugin scopes live.** Decided: (a), with Thomas's rule: core enforces only the scopes it imposes itself; the mechanism is open for plugins to declare their own; each plugin declares one namespace and can take up only that one (squadrons has `squadrons:<action>`), so it cannot spam namespaces. Format in part 6.
7. **How a ship asks squadrons.** Decided: (a) messages to squadrons' ship, content types `application/vnd.aeolus.squadron.*`.
8. **Members of a ship-formed squadron forming in turn.** Decided: (b) "no policy, the squadron blueprint decides. Else it would be us guessing and putting a security stamp on it." A template names the scopes its ships get; squadrons grants them at commission within the subset rule (scopes it holds, and its own namespace).
9. **Limits on forming.** Decided: (a) "indeed no policy": squadrons' configuration (per fleet, per forming ship, members per squadron), unset is none.
10. **The forming ship and its squadron.** Decided: (a) "scalable, but through the flagship, that ship is the proxy towards the forming ship. When the squadron was created by argo, it is a proxy to argo. If it was by another ship it is that ship." Mechanism above.

New, open:

11. **The message a stopped turn was working on.** A forced message stops a turn that took an earlier, acknowledged delivery. 0040 calls a delivery handled only when its turn ends by itself, and hands it once more only after a turn died.
    Options: (a) handled when the next turn (the forced one) ends by itself: the session still holds the earlier message, and the agent decides whether to go back to it; (b) handed once more after the forced turn, as for a died turn; (c) not handled, shown in Needs attention for Resend or Dismiss.
    Pick: (a). Stopping is not dying; (b) would hand the agent a message it already has, and (c) asks the operator about work the agent can resume.
12. **Reach between a forming ship and its flagship while network rules are in force.** Question 5 keeps squadrons from labelling the forming ship, so squadrons cannot declare that reach itself.
    Options: (a) argo writes it: argo labels the ships it lets form with a label of its own and adds a rule to and from flagships (`squadron-role=flagship`); a flagship is code run by squadrons, not a session, and relays only for its own forming ship, so reaching every flagship gives a forming ship nothing more; (b) core widens the `labels:assign` bound to ships that sent the owner's ship a message, so squadrons labels the forming ship and declares the rule; (c) only the answer exception of 0034: the forming ship always writes first, the flagship only answers.
    Pick: (a). No new core rule, and reach stays argo's; without rules (all-to-all, the default) nothing is needed.
13. **A forming ship that is retired.** A send to a retired ship is refused; a released one just waits for crew.
    Options: (a) the flagship proxies to argo from then on, as for a squadron argo formed; (b) the squadron stands down.
    Pick: (a). The work in flight is not lost, and argo decides.
14. **`fleet:manage` bound** (gap G6, forced by the catalogue). Today it acts on any ship.
    Options: (a) ships it commissioned, argo any; (b) any ship, as today.
    Pick: (a). Squadrons releases, retires and requests crews only for ships it commissioned, and the trierarch plugin needs no `fleet:manage` at all once `fleet:commission` exists, so nothing breaks.

---

## 6. The scope catalogue

### Format

- A scope is `<namespace>:<action>`. Namespace and action: lowercase `a-z`, `0-9` and `-`, starting with a letter, 1 to 32 characters each.
- **Core namespaces**, reserved: `messages`, `fleet`, `crew`, `labels`, `scopes`. Core enforces these, and only these.
- **A plugin namespace**: a ship holding `scopes:declare` declares its namespace and its scopes with `fleet.declareScopes` (`{ namespace, scopes: [{ action, description }] }`), its whole list each time, as `declareNetworkRules` does (0037). Its first declaration takes up the namespace for good; it can never declare another. The description is one line of at most 200 characters, for the console.
- Core stores a plugin's scopes on the ships granted them and answers them wherever it answers scopes (`fleet.list`, `fleet.ship`, `console.session`), so the plugin reads them from the fleet. It never checks them. `fleet.scopes` (`fleet:read`) lists every namespace with its declaring ship and its scopes.
- Core refuses (each refusal named): a malformed scope; declaring a core namespace; a namespace another ship took (CONFLICT, naming it); a second namespace from the same ship; more than 20 scopes in a namespace; removing a scope ships hold (naming them, as label values, 0031); granting a scope nobody declared; granting a core scope the granter does not hold; granting a plugin scope by any ship but argo or that namespace's declarer.
- Retiring the declaring ship retires its namespace: its scopes go from every ship, and the namespace is free again (as labels, 0031). Events: `ScopesDeclared` (declaring ship, namespace, the number of scopes) and `ScopesChanged` (ship, added, removed, by whom).
- Granting: at commission, the commissioner grants scopes it holds and scopes of its own namespace. On a live ship, a ship with `scopes:grant` grants and revokes within the same rule; argo holds everything, so argo grants anything. Every agent ship gets `messages:send` and `messages:receive` at commission.
- Not scopes, unchanged: `explainReach` and `reachRefusals` stay argo's by kind (0034).

### Core scopes

| Scope | Allows | Guards | Bound | Held by default | Granted by |
| --- | --- | --- | --- | --- | --- |
| `messages:send` | send a message, answer one | `send`, `fleet.reply` | as its own ship; reach applies | argo, every agent ship | given with every agent ship |
| `messages:receive` | receive, acknowledge, answer a ping, read its inbox; the computer side's push receive, handed, handled, not handled, turn; argo's read and done | `receive`, `ack`, `pong`, `inbox`, `pushReceive`, `handed`, `handled`, `notHandled`, `turn`, `fleet.markRead`, `fleet.markDone` | its own ship | argo, every agent ship | given with every agent ship |
| `messages:force` | send a message forced: handed over first and at once, a busy turn stopped | `send` with `force` | ships it reaches | argo | argo; a commissioner holding it |
| `messages:resend` | resend or dismiss an undeliverable or not handled delivery | `fleet.resend`, `fleet.dismiss` | any ship | argo | argo; a commissioner holding it |
| `fleet:read` | read the fleet, every payload included | `fleet.list`, `ship`, `shipTimeline`, `shipMessages`, `message`, `shipWay`, `needsAttention`, `overdue`, `noShipCanTake`, `health`, `inbox`, `follow`, `events`, `labels`, `findLabelValue`, `limits`, `clearRequests`, `scopes` | any ship | argo, viewer, squadrons, trierarch plugin, networking plugin | argo; a commissioner holding it |
| `fleet:commission` | commission an agent ship, granting it only scopes the caller may grant | `fleet.commission` | new ships, which count as commissioned by it | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `fleet:manage` | rename, release, crew again, retire, get a starting prompt, ping, request crew and remove the request, clear a worktree | `fleet.rename`, `release`, `recrew`, `retire`, `getStartingPrompt`, `ping`, `crewRequest`, `removeCrewRequest`, `clearWorktree` | ships it commissioned; argo any (question 14) | argo, squadrons | argo; a commissioner holding it |
| `crew:assign` | assign a crew request, say why none fits | `fleet.assignCrew`, `explainCrewRequest` | any crew request | argo, trierarch plugin | argo; a commissioner holding it |
| `crew:run` | for the crew requests assigned to its ship: read them, get the starting prompt, release, write status, give back, confirm a release, read and confirm clear requests | `fleet.assignedCrewRequests`, `getStartingPrompt`, `release`, `reportCrewStatus`, `confirmCrewRelease`, `giveBackCrewRequest`, `clearRequests`, `confirmWorktreeCleared`, `ship` | ships whose request is assigned to its own ship | argo, trierarch ships, trierarch plugin (question 2) | argo; a commissioner holding it (the trierarch plugin) |
| `labels:define` | define, change and delete its labels; declare network rules on them | `fleet.defineLabel`, `changeLabelValues`, `deleteLabel`, `declareNetworkRules` | labels it owns | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `labels:assign` | assign and unassign values of labels it owns | `fleet.assignLabel`, `unassignLabel` | its own ship and ships it commissioned; argo any (question 5) | argo, squadrons, trierarch plugin | argo; a commissioner holding it |
| `fleet:network` | register as the networking plugin, set the rules (the registered plugin only), read declared rules | `fleet.registerNetworkPlugin`, `unregisterNetworkPlugin`, `setNetworkRules`, `declaredNetworkRules` | the fleet's rules | argo, networking plugin | argo; a commissioner holding it |
| `scopes:declare` | take up one plugin namespace and declare its scopes | `fleet.declareScopes` | its own namespace | argo, squadrons | argo; a commissioner holding it |
| `scopes:grant` | grant and revoke scopes on a live ship | `fleet.grantScopes` | scopes it may grant (above); argo any | argo | argo |

### Scopes squadrons declares (namespace `squadrons`, declared by the plugin, enforced by squadrons only)

| Scope | Allows | Guards | Bound | Held by default | Granted by |
| --- | --- | --- | --- | --- | --- |
| `squadrons:form` | ask squadrons to form a squadron from a blueprint; it then owns it: stands it down, gets its relays | `squadron.form+json` to squadrons' ship; `squadron.stand-down+json` to the flagship | squadrons it formed | none (argo holds it) | argo; squadrons at commission when a template names it (question 8) |
| `squadrons:scale` | add and remove members of a squadron it owns | `squadron.add-member+json`, `squadron.remove-member+json` to the flagship | squadrons it formed | none (argo holds it) | argo; squadrons at commission when a template names it |

argo holds every scope, a plugin's too, and squadrons' console API keeps checking the operator's session as today.

### From today's scopes to these

No compatibility layer (0013): one migration sets every ship's scopes, and the old names stop existing.

| Today | Becomes | Change |
| --- | --- | --- |
| `messages:send`, `messages:receive` | same | unchanged |
| (none) | `messages:force` | new |
| `fleet:manage` (resend, dismiss) | `messages:resend` | split out |
| `fleet:read` | same | unchanged, also guards `fleet.scopes` |
| `fleet:manage` (commission) | `fleet:commission` | split out; grants only what the caller may grant |
| `fleet:manage` (the rest) | `fleet:manage` | narrowed to ships it commissioned |
| `crew:assign`, `crew:run`, `labels:define`, `fleet:network` | same | unchanged |
| `labels:assign` | same | narrowed to its own ship and ships it commissioned |
| (none) | `scopes:declare`, `scopes:grant` | new |

Holders after the migration: argo every core scope; a ship holding `fleet:manage` today also gets `fleet:commission` and `messages:resend`, so it keeps what it did, within the new bounds; squadrons gains `fleet:commission` and `scopes:declare`; the trierarch plugin swaps `fleet:manage` for `fleet:commission` and gains `crew:run`; the networking plugin, trierarch ships and the viewer are unchanged. The console's Connect sets these sets for a new connection.
