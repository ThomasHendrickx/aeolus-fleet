# argo's inbox: reaching the people who may act as argo

Design for [#1571](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1571), from the investigation on [#1569](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1569#issuecomment-6561940831). The purpose (section 1) is agreed. The lessons (section 2) and the questions (section 3) wait for Thomas's answers; the flow diagram and the mockups follow once they are in.

Thomas, 1 Nov:
1. "now argo is just a hidden box of problems and the biggest issues are being send to argo. So this is a big incident waiting to happen that could have been prevented having read the messages of argo."
2. "But make sure that it is clear if it is for argo or just the person."

## 1. Purpose (agreed)

What goes wrong today: the trierarch, squadrons and the plugins send argo their biggest problems (a computer low on disk, an API key out of credit, session starts failing, a model refused, a flagship released, formation recovery given up), and ships whose owner retired fall to argo with their questions. All of it waits in the console's inbox and nowhere else. A person learns of it only with a console session open that reads argo's inbox, by the count in its navigation: no push, email or Slack carries it, and the gateway's wakes, Slack and Bridge cover person ships only. Only the one console sign-in as argo can mark read, reply or mark done, and nothing expires or escalates, so a message waits unseen until the trouble it reported arrives.

The purpose: what waits at argo reaches a person who may act as argo while it can still prevent the trouble, and that person can act on it.

Who must learn, and how fast: every account allowed to sign in as argo, through its own person ship, wherever that person ship shows (Bridge, Slack, a chat), as fast as a message to that person ship reaches them today. Opening the console is not the way they find out.

The outcomes:
1. A person who may act as argo learns that something waits at argo, and what it is from its headline, without the console open.
2. From there, acting on it as argo is one step away.
3. Wherever a person sees what waits at argo (Bridge, Slack, a chat), it is plainly marked as argo's, apart from what is for that person alone.
4. What one of them handled is handled for all of them, and nobody is told again of it.

Not the purpose:
- **No change to the delivery guarantee.** Core stores and delivers as it does; a message to argo stays argo's, in argo's inbox.
- **argo stays the fail-safe, never a normal path** (0057). This design does not send more to argo; what the trierarch, squadrons and the plugins send there, and whether they should, is a separate question.
- **A person ship never acts as argo.** What a person ship sends is its own; acting on argo's inbox stays argo's.

## 2. Lessons checked against

From running the fleet:
- **The biggest problems go to argo.** The trierarch sends straight to argo what is about its computer (low on disk, an API key out of credit, session starts failing) and what is about a ship (model refused, no identity, unpushed work discarded); squadrons send a released flagship and formation recovery given up (#1569, section 1). They are the messages that must not wait.
- **A headline is what a person reads first.** A message to argo opens with its headline (protocol rule 6); the console shows the first line as the headline. The trierarch plugin sends `text/plain` with no headline line (#1569, gap 6), so its messages show a sentence cut short.
- **Folding hides.** The console folds plugin senders into one row by sender type; a message from a ship of another type is not folded (#1569, gap 7). What is folded is easy to pass over.
- **Problems found only by asking or by looking.** As with Bridge (its section 3): awareness comes to the person, not the person to it.

From what is decided:
- **argo is the fail-safe** (0057): where a failure becomes visible and the way out, never a normal path. Reaching people must not make argo a place ships send to by default.
- **One console sign-in as argo at a time** (0012, 0054): a new sign-in as argo ends the last, whoever's. Acting today means taking argo from whoever holds it.
- **Only argo acts on argo's inbox**: mark read, reply and mark done refuse any ship but argo (`NOT_THE_OPERATOR_SHIP`); "Compose, Done and Reply stay argo's" (blueprint, Inbox).
- **An account already reads argo's inbox** by its read reach with `fleet:read` (0034, `read-inbox.ts`); a ship, a person ship included, reads argo only by a rule. The account token says whether the account is allowed as argo (0058).
- **Nothing is argo's alone** (0053): every argo job is a scope any actor can hold.
- **Bridge is not argo's console** (Bridge, section 1): one record, many views; the person ship is the identity; argo's inbox is not redesigned there.
- **Waking a person** (wake-a-person W1 to W10): web push and email say only that something waits, with a link; each delivery woken once, gathered per window; nothing on by default (W8). Slack shows what waits at a linked person ship (gateway-scopes 9.4, P-B5).
- **Core has no email, push or Slack** (0058): what reaches a person goes through the gateway.

## 3. Questions

Each with numbered options and my pick. No detailed decision is taken before Thomas answers.

**AI1. How does what waits at argo reach a person allowed as argo?**
1. The gateway reads argo's inbox with the account token of each account allowed as argo, and shows it in Bridge, Slack and the wakes beside the person's own, marked argo's. One record: argo's inbox; no copy.
2. Core sends each allowed account's person ship a notice for every message to argo. A copy per person, each with its own state.
3. A plugin ship with a read rule on argo forwards each message to the allowed people's person ships.

Pick 1: an account already reads argo's inbox (section 2), there is one record, so what one person handled is handled for all (outcome 4) with nothing to keep in step, and core stays as it is. Options 2 and 3 make copies that each need clearing, and 2 has core send messages it sends nowhere today.

**AI2. How does a person act on it as argo (outcome 2)?**
1. Each item links to its message in the console; the person signs in as argo there (0054) and acts. No change to 0012: the sign-in ends whoever held argo.
2. An account allowed as argo acts on argo's inbox (mark read, reply, answer, mark done) by its account token, in place in Bridge or Slack, without taking argo's lease; the event names the account (0057). Changes the rule that only argo's sign-in acts.
3. As 2, behind a scope any actor may hold (0053) rather than "allowed as argo".

Pick 1: it meets "one step away" with nothing reopened. Option 2 removes the takeover of someone else's sign-in, but it reopens 0012 and the "Done and Reply stay argo's" rule, so it is Thomas's to open.

**AI3. Which of argo's messages reach them?**
1. Every open message to argo, questions included, plugin senders unfolded.
2. Every open message, plugin senders folded into one item as in the console.
3. Only questions and the trierarch's and squadrons' reports.

Pick 1: the biggest problems come from plugin senders (section 2), and folding is what hides them.

**AI4. How is argo's marked apart from the person's own (outcome 3)?**
1. Its own section and count, named argo, in Bridge; in Slack and the wakes each item says it waits at argo.
2. One list, each of argo's items tagged argo.

Pick 1: a separate place and count cannot be read as the person's own; a tag in a mixed list can be missed.

**AI5. When does a person get woken for argo's messages?**
1. As for their own (W1 to W10): each message woken once per person, gathered per window, only on channels the person turned on (W8).
2. On for argo's by default for every account allowed as argo, consent or not.

Pick 1: the same rules a person already chose; consent stays first.

**AI6. What if nobody handles it?**
1. Nothing more: once everyone allowed as argo has been told, it waits, shown and counted, as today.
2. A reminder after a time from the gateway's configuration.

Pick 1: the purpose is that it reaches people, and reminders and escalation are a design of their own (wake-a-person leaves them out too).

**AI7. A fleet with no account allowed as argo (argo's own sign-in, no pagasae, 0054)?**
1. Nothing changes there: the console's count stays the way to learn.
2. Core tells argo's own sign-in by email.

Pick 1: core has no email (0058) and there is no person ship to reach.

**AI8. The trierarch plugin's messages without a headline?**
1. File an issue on the trierarch plugin to open them with a headline (protocol rule 6); this design shows the first line, as the console does.
2. Fix it in this design's build.

Pick 1: it is the plugin's defect in another repository, not this design.
