# argo's inbox: reaching the people who may act as argo

Design for [#1571](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1571), from the investigation on [#1569](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1569#issuecomment-6561940831). The purpose (section 1) waits for Thomas's agreement; the lessons, the questions, the flow diagram and the mockups follow once it is agreed.

Thomas, 1 Nov: "now argo is just a hidden box of problems and the biggest issues are being send to argo. So this is a big incident waiting to happen that could have been prevented having read the messages of argo."

## 1. Purpose

What goes wrong today: the trierarch, squadrons and the plugins send argo their biggest problems (a computer low on disk, an API key out of credit, session starts failing, a model refused, a flagship released, formation recovery given up), and ships whose owner retired fall to argo with their questions. All of it waits in the console's inbox and nowhere else. A person learns of it only with a console session open that reads argo's inbox, by the count in its navigation: no push, email or Slack carries it, and the gateway's wakes, Slack and Bridge cover person ships only. Only the one console sign-in as argo can mark read, reply or mark done, and nothing expires or escalates, so a message waits unseen until the trouble it reported arrives.

The purpose: what waits at argo reaches a person who may act as argo while it can still prevent the trouble, and that person can act on it.

Who must learn, and how fast: every account allowed to sign in as argo, through its own person ship, wherever that person ship shows (Bridge, Slack, a chat), as fast as a message to that person ship reaches them today. Opening the console is not the way they find out.

The outcomes:
1. A person who may act as argo learns that something waits at argo, and what it is from its headline, without the console open.
2. From there, acting on it as argo is one step away.
3. What one of them handled is handled for all of them, and nobody is told again of it.

Not the purpose:
- **No change to the delivery guarantee.** Core stores and delivers as it does; a message to argo stays argo's, in argo's inbox.
- **argo stays the fail-safe, never a normal path** (0057). This design does not send more to argo; what the trierarch, squadrons and the plugins send there, and whether they should, is a separate question.
- **A person ship never acts as argo.** What a person ship sends is its own; acting on argo's inbox stays argo's.
