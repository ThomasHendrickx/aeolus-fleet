# Bridge: a person's one place to work with their fleet

Design for [#1494](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1494). Stage 0 (purpose, jobs, lessons, how others do it) is answered (section 5). Stage 1, the structure, follows. The questions design ([#1495](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1495)) resumes as the first slice of decide (CC11).

Thomas, 31 Oct:
1. "in essence that is a bit the command center for a user in aeolus.. like outlook is for emails or Gmail for Google ... But with different use cases and capabilities.. I don't want to make a choice now on this that I might regret so want to take a step back on what that interaction surface needs to be."
2. "I think the one we design is the default one. A user can choose where what gets routed to, or even to use multiple. As in the command center (needs a better name) or slack or a plain claude.ai chat... I like to give users options."
3. On places: "So places het a view of the thing. Same IMAP Vs pop principle".

## 1. Purpose (agreed, CC1)

A person works with their fleet from one place in Aeolus that holds everything their ships need from them and everything they should know, so nothing waits on them unseen and nothing they decided is lost. That place is **Bridge**, the default place; the person chooses, per job, whether Slack, a chat such as claude.ai, or several of them show it too, and every choice acts as the same person ship.

The outcomes:
1. What waits on the person (a question, an approval, a step only a human can take) is in one list with one count, each item saying what it asks and what pressing its button sends.
2. The person sees how their ships are doing without asking any of them.
3. Whatever the person decides or answers, wherever they did it, can be read back in Bridge.
4. The person chooses where each job shows, one place or several, and a change of mind loses nothing.
5. Every action is the person ship's, one identity whichever app or chat the person used.

Not the purpose:
- **No change to how core carries messages.** Core stores and delivers; it reads no payload and keeps no routing preference; choices live with the person ship's crew, as P-B5's do in the gateway (0038, 0043).
- **Not argo's console.** The console stays the fleet's admin console (0043); argo's inbox is not redesigned here.
- **Not executing.** Aeolus distributes; what a ship does with a person's answer is its own business.

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
- **State lost in conversations.** The orchestrator keeps Thomas's questions on a page outside Aeolus because a chat scrolls them away; a decision made in a chat is found again only by scrolling. Bridge holds the record, whatever else shows the item.
- **Problems found only by asking.** Thomas learns a ship is stuck when he asks "status?". Awareness comes to the person; monitoring already raises the facts (0071) and sends the owner an alert.
- **Actions buried in information.** An ask in the middle of a long report is missed. A message to argo opens with its headline (protocol rule 6); a question is its own content type (0038). What asks for action is apart from what informs.
- **The person ship is the identity.** A person acts as their account through their person ship (0052, 0057), one crew shared by every client the gateway serves (0015, 0054). Several places showing the same item are several clients of one crew, never several identities.

From what exists:
- **Person ships** (0044, 0045, 0052): own themselves and what they commission; questions, trouble and gates of their ships go to them.
- **The gateway's pages**: the Overview lists the inbox by titles only, opening one acknowledges it (the promise ends at opening, 0040), an open page in focus is the channel `page` (W6).
- **Slack** (gateway-scopes 9.4, 9.5): a linked person's messages go in as their person ship; what waits shows in Slack, a question with a button per option; each delivery handed with channel `slack`, then acknowledged.
- **Wake a person** (W1 to W10): web push and email say only that something waits, with a link; each delivery woken once, gathered per window; nothing on by default (consent first, W8).
- **P-B5**: the first per-person choice of where a delivery shows: Slack, the gateway page, or both, while a page is in focus. With both, Slack's acceptance acks it and the page shows only that Slack took it. One delivery is acknowledged once.
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

## 5. Stage 0 answered (Thomas, 31 Oct)

| # | Rule |
| --- | --- |
| CC1 | **The purpose is section 1.** |
| CC2 | **First jobs: decide, do what only a human can, and stay aware**, what reaches the person unasked. Direct, converse and review output later |
| CC3 | **Thomas first, built for every person ship**: one person owning a busy fleet, nothing that only fits one |
| CC4 | **Bridge always keeps the record.** Every item stays there with its outcome; other places show it too, and an answer in Slack or a chat shows in Bridge as answered |
| CC5 | **Routing per job.** Per job, the person turns each place on or off (Slack, a chat, web push, email), several at once, Bridge always on; defaults from configuration |
| CC6 | **Each place shows it; only the person's action acknowledges it.** A place showing an item is not the person receiving it |
| CC7 | **A chat is a pull place.** The item waits for the chat's `aeolus_inbox`, with a wake telling the person. Places are views of one record (IMAP), never copies that take the item away (POP) |
| CC8 | **The name is Bridge**, a blueprint term |
| CC9 | **Bridge lives in the gateway's web app**, which crews the person ship and holds the Slack link and the wakes |
| CC10 | **A job is known by content type**, as questions are (0038); a new fleet convention only where a job has none |
| CC11 | **The questions design resumes as the first slice of decide**, on Bridge |
