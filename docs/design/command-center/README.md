# A person's command center

Design for [#1494](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1494), a step back from the questions design ([#1495](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1495), paused). Stage 0: purpose, jobs, lessons, how others do it, and questions, for Thomas to agree. No screens and no detailed decisions. "Command center" is Thomas's working name; Q8 asks for a better one.

Thomas, 31 Oct:
1. "in essence that is a bit the command center for a user in aeolus.. like outlook is for emails or Gmail for Google ... But with different use cases and capabilities.. I don't want to make a choice now on this that I might regret so want to take a step back on what that interaction surface needs to be."
2. "I think the one we design is the default one. A user can choose where what gets routed to, or even to use multiple. As in the command center (needs a better name) or slack or a plain claude.ai chat... I like to give users options."

## 1. Purpose (to agree)

A person works with their fleet from one place in Aeolus that holds everything their ships need from them and everything they should know, so nothing waits on them unseen and nothing they decided is lost. It is the default place; the person chooses, per job, whether Slack, a chat such as claude.ai, or several of them show it too, and every choice acts as the same person ship.

The outcomes:
1. What waits on the person (a question, an approval, a step only a human can take) is in one list with one count, each item saying what it asks and what pressing its button sends.
2. The person sees how their ships are doing without asking any of them.
3. Whatever the person decides or answers, wherever they did it, can be read back in the default place.
4. The person chooses where each job shows, one place or several, and a change of mind loses nothing.
5. Every action is the person ship's, one identity whichever app or chat the person used.

Not the purpose:
- **No change to how core carries messages.** Core stores and delivers; it reads no payload and keeps no routing preference; choices live with the person ship's crew, as P-B5's do in the gateway (0038, 0043).
- **Not argo's console.** The console stays the fleet's admin console (0043); argo's inbox is not redesigned here.
- **Not executing.** Aeolus distributes; what a ship does with a person's answer is its own business.
- **Not screens.** Stage 1 decides structure once the purpose and jobs are agreed; mockups after.

## 2. The jobs a person has with their fleet

| Job | What it is | An example |
| --- | --- | --- |
| Decide | A ship cannot go on without the person's choice | The orchestrator asks which of three designs to build; a gate waits for approval |
| Do what only a human can | A step no ship can take for them | Sign in to an outside OAuth server (0067), approve an outside party (0056), link Slack, install a bot |
| Direct | The person sends work or changes course | Send a ship a task, ask a squadron to form, stop a ship, request crew |
| Stay aware without asking | The person learns state and trouble as it happens | A watch alert (0071), a ship stuck or silent, a PR opened, a release out |
| Converse | A back and forth with a ship or several | A thread with the orchestrator; a meeting (0061) |
| Review output | Judge what a ship made | A PR, a design doc, a report: a reference to where the content lives, never the content itself (256 KB, 0006) |

The first two wait on the person and block a ship; the next three are the person's own initiative or awareness; the last sits between (a review often ends in a decision).

## 3. Lessons checked against

From running the fleet:
- **State lost in conversations.** The orchestrator keeps Thomas's questions on a page outside Aeolus because a chat scrolls them away; a decision made in a chat is found again only by scrolling. The default place holds the record, whatever else shows the item.
- **Problems found only by asking.** Thomas learns a ship is stuck when he asks "status?". Awareness comes to the person; monitoring already raises the facts (0071) and sends the owner an alert.
- **Actions buried in information.** An ask in the middle of a long report is missed. A message to argo opens with its headline (protocol rule 6); a question is its own content type (0038). What asks for action is apart from what informs.
- **The person ship is the identity.** A person acts as their account through their person ship (0052, 0057), one crew shared by every client the gateway serves (0015, 0054). Several places showing the same item are several clients of one crew, never several identities.

From what exists:
- **Person ships** (0044, 0045, 0052): own themselves and what they commission; questions, trouble and gates of their ships go to them.
- **The gateway's pages**: the Overview lists the inbox by titles only, opening one acknowledges it (the promise ends at opening, 0040), an open page in focus is the channel `page` (W6).
- **Slack** (gateway-scopes 9.4, 9.5): a linked person's messages go in as their person ship; what waits shows in Slack, a question with a button per option; each delivery handed with channel `slack`, then acknowledged.
- **Wake a person** (W1 to W10): web push and email say only that something waits, with a link; each delivery woken once, gathered per window; nothing on by default (consent first, W8).
- **P-B5**: the first per-person choice of where a delivery shows: Slack, the gateway page, or both, while a page is in focus. With both, Slack's acceptance acks it and the page shows only that Slack took it. One delivery is acknowledged once; several places need one of them to take it and the others to show that it was taken.
- **A chat such as claude.ai** (gateway MCP tools): it pulls (`aeolus_inbox`, `aeolus_open`); nothing pushes into it. Showing something there means keeping it for when the person asks, with a wake to tell them.
- **The console** (Questions to argo, the operator inbox): one count, open questions on top, the pick preselected, one tap naming what it sends, stale questions linked to their replacement. It is argo's and frozen for questions (0043); its rules are the tested ones to start from.

## 4. How others serve these jobs

| | Decide | Do what only a human can | Direct | Stay aware | Converse | Review output | What to take |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Outlook** | Actionable messages: approve in the mail | Flags and tasks the person keeps | New mail, meeting invites | Rules into folders, Focused and Other | Threads | Attachments, links | Rules per sender route mail; the person keeps state by flagging, so it is lost when they forget |
| **Gmail** | Little: reply | Snooze, follow-up nudges | New mail | Priority inbox, labels, filters | Threads | Links, Drive previews | Labels, not folders: one item in several views; snooze brings it back |
| **Slack** | Workflow and app buttons | Reminders, Later | Message a person or bot | Channels, Activity | Strong: DMs, threads, huddles | Links, unfurls | Conversation first; what was decided scrolls away, found by search |
| **Linear's inbox** | In place: change status, assign | Assigned to you | Create an issue | Notification per issue, subscriptions | Comments on the issue | The issue and its PRs | The item is the issue, not the message: state lives on it; snooze and done are the person's own |
| **GitHub notifications** | Review requested, approve in place | Review requested, assigned | Open an issue or PR | Per thread, with a reason (mention, assign, CI) | Comments on the thread | The PR itself | Each notification says why it reached you; the person picks web, email or both per kind of notification |

What carries over: the item is the thing that waits (a question, a request), not the message carrying it (Linear, GitHub); each item says why it reached the person (GitHub); actions happen in place (Outlook, Slack, Linear); one item can show in several places (Gmail labels); where each kind shows is the person's choice per kind (GitHub's web and email, P-B5). What not to carry over: state the person must keep by hand (Outlook's flags), and a conversation as the only record (Slack).

## 5. Questions, each with my pick

| # | Question | Options | My pick |
| --- | --- | --- | --- |
| Q1 | Is section 1 the purpose? | (a) Yes. (b) Narrower: only what waits on the person (decide, do). (c) Wider: also the person's view of the whole fleet, as the console is argo's | (a): Thomas's words name more than questions, and the fleet view stays the console's (0043) |
| Q2 | Which jobs are in first? | (a) Decide, do what only a human can, and stay aware: what reaches the person unasked. (b) All six at once. (c) Decide alone, the questions design resumed | (a): those are the ones lost in a chat and found only by asking; direct and converse already work from a chat and Slack, and review output arrives as a link inside the others |
| Q3 | For whom first? | (a) Thomas: one person owning a busy fleet, the orchestrator asking. (b) A person in an organisation with a few ships, as Mathilde in the gateway designs | (a): the need is live and the orchestrator moves into a ship now; built for every person ship, with nothing that only fits one |
| Q4 | Does the default place always hold the record, whatever else shows an item? | (a) Yes: every item stays there with its outcome; other places show it too, and an answer in Slack or a chat shows there as answered. (b) No: an item routed only to Slack lives only in Slack | (a): outcome 3, and the lesson of state lost in conversations |
| Q5 | How is the routing per job chosen? | (a) Per job, the person turns each place on or off (Slack, a chat, web push, email), several at once, the default place always on; defaults from configuration. (b) Per sending ship. (c) Rules on sender, job and content, as Outlook's | (a): GitHub's and P-B5's shape, a short list of choices; (b) and (c) can follow if a need shows |
| Q6 | With several places on, which one takes the delivery? | (a) The first place that shows it to the person hands and acks it; the others show that it was taken and where (P-B5's Both). (b) Each place shows it, and only the person's action acks it | (a): one delivery is acknowledged once (0040), and P-B5 already works so; (b) needs a second state per place |
| Q7 | How is a chat such as claude.ai a place, since nothing pushes into it? | (a) A pull place: the item waits for the chat's `aeolus_inbox`, with a wake telling the person. (b) Not a place for routing; a chat only reaches the default place's items when asked | (a): it keeps Thomas's option and costs no new part |
| Q8 | The name | (a) **Bridge**: where a ship's commander stands to see, decide and direct; the fleet's own vocabulary. (b) **Helm**: where the ship is steered from; narrower, direct only. (c) **Navarch's deck** (Greek: the navarch commanded a fleet): names the person's role rather than the place. (d) **Inbox**: plain, but names one job of six | (a): concrete, and it names the place, not a metaphor; a new term for the blueprint |
| Q9 | Where does it live? | (a) The gateway's web app, which crews the person ship, holds the Slack link, the wakes and the person's Overview today. (b) A new app in core's train. (c) The console | (a): 0043 keeps people out of the console, and the gateway already has every part a person uses |
| Q10 | How does a job become known from a delivery? | (a) By content type, as questions are (0038), a new fleet convention only where a job has none (an alert has one, 0071). (b) The sender names the job in a field. (c) The place guesses from the payload | (a): core reads no payload and the convention already works; the gateway reads types it knows |
| Q11 | What happens to the questions design? | (a) It resumes as the first slice of decide, on the default place, once this purpose is agreed. (b) It is folded into stage 1 here | (a): its questions hold; only Q2 there (where it lives) is answered here |
