# Questions for a person

Design for [#1494](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1494). Stage 1: purpose, what is true today, lessons and questions, for Thomas to agree. No decisions or mockups until the purpose is agreed; the before and after mockups come in stage 2.

Thomas, 31 Oct: "One thing we are going to do tomorrow and the day after is move this chat session more and more into a trierarch managed ship. Makes it more deterministic and it can get woken up on new messages. This chat or another will then move into my ship. One piece missing (make the gh issue and set it on the next release) is a way that I can capture questions as we do now in an artifact."

## 1. Purpose (to agree)

A person answers every question their ships ask them in one place in Aeolus, as quickly as on the page the orchestrator keeps for Thomas today, and each asking ship gets the answer as a reply it already knows how to receive.

The outcomes:
1. Every open question to Thomas's person ship shows in one view, grouped, each with its context, its numbered options and the asker's pick with why.
2. Thomas answers with an option and an optional note, or a note alone. The answer goes back as a reply of the answer content type (0038), and the asking ship receives it like any reply.
3. A question its asker withdrew or replaced can no longer be answered, and points to its replacement.
4. Answered questions stay readable with their answers, so Thomas can read back what he decided.
5. The orchestrator keeps no questions page outside Aeolus once it crews a ship.

Not the purpose:
- **No change to how core carries questions.** Core stores and carries them like any message and never reads a payload (0038).
- **Not argo's questions.** The console's Questions to argo is frozen and later moves out (0043); this design does not change it.
- **Not asking.** Ships already ask with the question content type; the plugin has `aeolus-ask.sh`.
- **Not waking.** Telling a person something waits is [wake-a-person](../wake-a-person/README.md).

## 2. What is true today

- **The orchestrator's page** (the claude.ai artifact; read from the issue, since it is not shared with this session): questions grouped in tabs per topic, each with its context, numbered options and the pick with why; Thomas answers by choosing an option plus a note, and the orchestrator reads the answers back from the page. It lives outside Aeolus and nothing travels as a fleet message.
- **The convention** ([0038](../../decisions/0038-questions.md)): question, answer, withdrawal and replacement content types, schemas in `common/src/schemas/question.ts`. A question has `id`, `title`, `context`, `options` and `pick`; it has no topic. A question is open until the asked ship sends an answer naming it; a withdrawal or replacement from its sender before that makes it stale.
- **The ship protocol** (the Aeolus MCP instructions, rule 5): a ship asks its owner's ship, as whoami names it. A ship argo owns asks argo, whose questions the console shows.
- **Owners** ([0045](../../decisions/0045-owners.md)): a ship's owner is a person ship or argo; trierarch and plugin ships are argo's. Whether the orchestrator asks Thomas's person ship or argo depends on who owns the ship it crews.
- **The console** ([Questions to argo](../../blueprint.md#questions-to-argo), OperatorInbox): open questions on top of argo's inbox, oldest first, one count; the pick preselected; one tap on a button that names what it sends; a note; stale questions under Done, linked to their replacement; Next question, never moving on by itself.
- **The gateway's pages** (`aeolus-fleet-gateway`, `web/features/overview`, design B Signal): the gateway crews the person ship. The Overview lists the inbox by titles only, so no payload leaves the fleet unopened (`src/core/people/inbox-entry.ts`); a question's title is its own. Opening one acknowledges it for the person (wake-a-person section 2) and shows it in focus, one at a time: context, a button per option with the pick on a dashed edge, the pick's why, a note, Send the note alone. Opened and not dealt with ones are listed apart. The person pages handle no withdrawal or replacement: those show as plain messages.
- **Slack** (gateway README, Slack 9.5): a linked person sees a question with a button per option; a press answers as the person ship.
- **The UI package** ([ui-package](../ui-package/README.md)): a part two apps show is built once in `@aeolus-fleet/ui`; one app's own part stays in that app (UP2). The chosen look is Compact ([mockups](../ui-package/mockups/README.md#the-look-compact)), built in slice U4.

## 3. Lessons checked against

- **0038.** One place and one count tell the person whether anything waits; a Questions page and tab beside the inbox was rejected (two places and two counts). The pick is one tap away; no confirm, and never jumping to the next question by itself.
- **0043.** Core is the fleet's admin console, for argo; people reach their person ships through their own app, a chat or the gateway. A person's questions view is not a console page.
- **0040 and wake-a-person.** For a person the promise ends at opening, the gateway's ack. A view that shows many questions whole has to say which of them it opened.
- **The gateway's titles-only inbox.** A list shows no payload before the person opens it.
- **0033.** The server reads and checks the question and the answer; the browser renders what it is given.
- **UP2.** A question part both the console and the gateway show belongs in `@aeolus-fleet/ui`.
- **0013.** No paid-product polish: what the orchestrator's page does, not more.

## 4. Questions, each with my pick

| # | Question | Options | My pick |
| --- | --- | --- | --- |
| Q1 | Whom does the orchestrator ask once it crews a ship? | (a) Thomas's person ship: the ship it crews is owned by it. (b) argo: the console's Questions to argo already does all of this | (a): the issue asks for the person ship, and "this chat will move into my ship" reads as owned by Thomas's ship |
| Q2 | Where does the view live? | (a) The gateway's pages, for the person ship the gateway crews. (b) The console. (c) Both | (a): 0043 keeps people out of the console, and the gateway already crews the person ship and answers its questions |
| Q3 | A view of its own, or inside the inbox? | (a) The questions on top of the Overview's inbox, one count, as argo's inbox does. (b) A Questions page or tab beside the inbox | (a): 0038 rejected two places and two counts |
| Q4 | What groups the questions? A question has no topic today | (a) The asking ship. (b) A new optional `topic` in the question payload (a change to 0038), falling back to the asking ship. (c) No grouping, oldest first | (b): the orchestrator asks about many issues from one ship, so grouping by ship puts them all in one group; the page today groups by topic |
| Q5 | How much shows before the person opens a question, given opening acknowledges it? | (a) Titles only, grouped; opening one shows it whole, and opened questions stay whole in the list until answered. (b) Every open question whole at once, the view opening each one it shows | (a): it keeps the titles-only rule and the ack meaning "the person saw it"; after one pass the list reads like the page today |
| Q6 | Withdrawn and replaced questions on the gateway | (a) As Questions to argo: stale, not answerable, linked to the replacement, the withdrawal itself left out. (b) Leave them as plain messages | (a): one rule for every asked ship, as 0038 states it |
| Q7 | Reading back | (a) Answered and stale questions under Done, each with its answer or notice, grouped as the open ones. (b) No history beyond the inbox | (a): outcome 4 |
| Q8 | One question part for the console and the gateway? | (a) The question card (options, pick, note, the button naming what it sends) in `@aeolus-fleet/ui`, both apps taking it; the console's behaviour unchanged. (b) The gateway keeps its own | (a): UP2; two apps show the same part |
| Q9 | Each answer at once, or a batch? | (a) Each answer sent when its button is pressed, as today. (b) Choose for several, then send them together | (a): the button names what it sends; a batch adds a state that can be lost |
| Q10 | The look | (a) Mockups and build in Compact, after U4 lands. (b) Today's look now, Compact with U4 | (a): Compact is chosen, and the gateway takes it from ui |
