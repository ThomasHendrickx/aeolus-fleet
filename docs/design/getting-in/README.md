# Getting into the fleet

Design for [#1228](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1228). Stage 1: purpose proposed, lessons, open questions G1 to G8 with a pick each. No detailed design and no mockups until Thomas agrees the purpose.

Thomas (25 Oct), verbatim: "Since our main advantage now against the competition we identified is our focus on connecting technical to non technical people on a company, user friendlynes to get into the fleet should be flawless"

## 1. Purpose (proposed, G1)

Two people of one company, one technical and one not, each get from their first mail to doing their part in the same fleet on their own: no help, no guessing, and nobody who knows how Aeolus works inside. The non-technical person never sees a terminal, an id, JSON or a word nobody explained. What Aeolus offers over other tools is the hand-off between the two people, so getting in counts as done only when both are in and a ship has reached the non-technical person.

### Who gets in

| Who | Technical | First mail | Done when |
| --- | --- | --- | --- |
| **The founder**: signs up first, so is the first organisation admin and the fleet manager (0051) | Either | The sign-up link | The fleet exists, and the founder has handed the technical setup to someone or done it |
| **Ada**: sets the fleet up, joins a computer, commissions and crews the first ship | Yes | The sign-up link or an invite | Her first ship has answered her first message |
| **The organisation admin**: lets colleagues in with the rights they need. Often the founder | Either | None of its own | The colleague's rights work on arrival, with nothing to ask the hosting service for |
| **Bea**: an invited colleague who answers ships, takes steps and joins meetings | No | The invite | She has answered the first question a ship asked her, and knows how she will hear about the next one |

### What flawless means

1. **No dead end.** Every screen and terminal line says what comes next. Every failure says what happened, whether anything changed and what to do next, so nobody is stuck.
2. **Nothing to guess.** A word, a choice or a permission is explained where it first appears, before it is asked for. Bea's path has no unexplained terms at all.
3. **No insider way out.** Nobody needs argo's fail-safe (0012), a hand-built command, a repository's README or the hosting service to finish a normal step.
4. **One product.** Moving between the account app, the console, Bridge and the computer's terminal, the person meets one header, one set of parts, one set of words and one way of saying what failed.
5. **Proven by walking.** A new technical person and a new non-technical person, each walked fresh on staging with no help, reach their done row above, with no friction ranked Blocks or Hurts (the audit's ranks).

### In scope

The hosted path from the first mail to each person's done row: sign-up and sign-in, the first fleet, the first console open, connecting the trierarch plugin, joining a computer (up to the setup line and back), commissioning and crewing the first ship, inviting a colleague with rights, the invite mail, the colleague's first arrival and her first answer, and how she chooses to hear about the next item.

### Out of scope

- **Computer setup in the terminal**: what the setup line asks and shows on the computer is [#1243](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1243), approved in [computer-setup](https://github.com/ThomasHendrickx/aeolus-fleet/blob/design/1243-computer-setup/docs/design/computer-setup/README.md) ([PR #1888](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1888)). This design only hands over to it and takes back the joined computer.
- **Bridge itself**: what Bea's one place holds and does is [Bridge](../bridge/README.md), approved. This design covers how she reaches it the first time.
- The commercial plan, pricing, a marketing site, listing Aeolus in chat apps' directories ([#1214](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1214)), other channels ([#1229](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1229)).
- Connecting Entra or Google for a company ([company-sign-in](../accounts/company-sign-in.md)).
- Self-hosting ([one-line-setup](../one-line-setup.md)).
- Building the ui package's parts, Harbour or the Compact look: settled elsewhere, used here.

## 2. Lessons to check against

### 2.1 Earlier work on #1228

- **[PR #1317](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1317)**, `design/onboarding`: the first onboarding design. Its purpose (27 Oct, restarted 31 Oct as R1) was proposed, not approved, and Thomas paused it on 31 Oct: "let's pause onboarding. O want to have a commercial plan first". Thomas answered its first-round questions Q1 to Q10 on 27 and 28 Oct, then said: "I made some assumptions answering the questions, but I don't want to start doing like major changes based on those assumptions. So every time that we are going to do adjustments on screens and everything like that, I do want to have a gate that goes through me." The answers that bear on this purpose:
  - Q1: scenarios per friction, and one final walk of both people on staging as the release gate.
  - Q2: each page's empty state names the next step from the fleet's own state; the guide stays a short orientation.
  - Q3: the installation's default for new fleets includes the gateway; where it is off, Home tells the colleague why.
  - Q4: design for the technical person first; the hand-off is named where joining a computer is refused.
  - Q5: the setup line asks nothing and applies safe defaults. Since then Thomas approved, for #1243, that setup explains and asks every applicable choice. The newer answer wins for the terminal.
  - Q9: the invite mail names the inviter and the organisation and says what Aeolus is.
  - Q10: Bea's pages show fewer terms; Ada's console explains each term once where it first appears; no term is renamed.
- **[PR #1232](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1232)**, the onboarding audit (25 Oct, staging 0.31.0), `docs/audits/onboarding-2026-10-25/README.md` on `audit/onboarding`: Ada and Bea walked, frictions F1 to F28 ranked Blocks, Hurts, Rough. Not walked: production's defaults, Codex, a real company directory, a real chat client, a real computer after setup.

### 2.2 The audit's frictions now

Status read from the issues on 16 Nov, not walked again.

| Status | Frictions |
| --- | --- |
| Open | F1 no gateway in a new fleet, nobody can switch it on ([#1233](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1233)); F12 nine unexplained setup questions ([#1243](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1243), design approved, not built); F17 "Can't reach the sign-in service" on the first console open ([#1248](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1248)); F20 to F28, no issues |
| Closed | F2 ([#1234](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1234), [#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303)), F3 ([#1235](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1235)), F4 ([#1236](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1236)), F6 and F10 (gateway [#238](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/238), [#237](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/237)), F7 ([#1238](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1238)), F8 ([#1239](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1239)), F9 ([#1240](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1240)), F13 ([#1244](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1244)), F14 ([#1245](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1245)), F15 ([#1246](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1246)), F16 ([#1247](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1247)), F18 ([#1249](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1249)), F19 ([#1250](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1250)) |
| Not planned | F11 email alerts off by default. Thomas (28 Oct): "off by default or it is a violation of peoples rights" ([#1242](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1242)) |
| Not a block | F5 ChatGPT's connection to the gateway |

### 2.3 Later walks of a new person

A brand-new account on staging and clean Debian 12 and Ubuntu 24.04 computers, 3 Nov, all closed since: Join machine refused with only a scope name ([#1609](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1609)); no new starting prompt for a ship the person commissioned ([#1608](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1608)); the README's global install fails with EACCES and Node 26 has no install step ([#1610](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1610)); no session without `ss` ([#1611](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1611)); a failed start hides its cause ([#1612](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1612)); init goes on without a Claude Code sign-in ([#1613](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1613)); no session on systemd older than 254 ([#1615](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1615)). Also: a fresh self-hosted fleet could not commission its first agent ship ([#1806](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1806)); Request crew could not be submitted while no computer reports ([#1721](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1721)).

The lesson: most frictions were found only by walking as a new person on a clean computer, several after a fix passed in core. A fix is not done for this design until a fresh walk passes on hosted ([#1303](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1303): fixed in core, still failing on hosted while another train lagged).

### 2.4 Decisions and designs

| Lesson | Source |
| --- | --- |
| Sign-up creates the organisation, its first account (organisation admin) and its first fleet; the fleet manager holds every scope the fleet offers; the organisation admin's right never implies fleet scopes | [0051](../../decisions/0051-organisation.md) |
| pagasae signs every account in; groups and rights live in the account app; one sign-in for every app; the gateway's one address finds the person's fleets and crews their person ship | [0054](../../decisions/0054-sign-in.md), [0052](../../decisions/0052-groups.md) |
| Argo is the fail-safe, never a normal path; every argo job is a scope any actor can hold | [0012](../../decisions/0012-operator-is-a-ship.md), [0053](../../decisions/0053-nothing-is-argos-alone.md), [0057](../../decisions/0057-actors.md) |
| Adding a computer takes `trierarch:join`, checked on whoever adds it; a trierarch on a person's computer is owned by their person ship | [0055](../../decisions/0055-leavers.md), [0045](../../decisions/0045-owners.md) |
| A starting prompt, crew line or setup line is shown once; a lease holds until released | [0010](../../decisions/0010-leases-without-heartbeats.md) |
| The installation sets one guide per audience, progress kept per account | [0024](../../decisions/0024-guide.md) |
| Commission form: send and receive first, extras one by one in plain words; a disabled button says what is missing beside it | [0075](../../decisions/0075-commission-form-and-permissions.md) |
| One meaning per term, defined in the blueprint; name the concrete part, invent no synonym | [0050](../../decisions/0050-domain-language.md), [words](../../guide/words.md) |
| No policy: explain consequences, add no protective rules | [0016](../../decisions/0016-no-policy.md) |
| Errors say what failed, whether anything changed and what to do; an empty state says what happens next; a disabled control shows its reason | [conventions](../conventions.md) |
| Bridge is the person's default place; the person chooses where each job also shows (Slack, a chat such as claude.ai) | [Bridge](../bridge/README.md) |
| Waking a person: consent first, nothing on by default | [wake-a-person](../wake-a-person/README.md), F11 above |
| Harbour is the first fleet view; a new fleet already shows argo, people and plugin ships, no agent | [fleet-overview](../fleet-overview/README.md) |
| Sessions run headless; crew lines exist for Claude Code, Codex, Copilot and Cursor | [headless](../headless/headless.md) |
| Feature flags and plugin defaults for new fleets are set in pagasae | [0069](../../decisions/0069-feature-flags.md), F1 |
| Before 1.0.0, keep designs minimal; no paid-product polish for zero customers | [0013](../../decisions/0013-breaking-changes-before-1-0.md), AGENTS.md |

### 2.5 The guide

[What is Aeolus](../../guide/what-is-aeolus.md), [commission and crew](../../guide/commission-and-crew.md), [console](../../guide/console.md), [answer your agents](../../guide/answer-your-agents.md), [words](../../guide/words.md), [troubleshooting](../../guide/troubleshooting.md). The guide is written for the technical person and reached from GitHub (F20: Help opens the repository, for Bea too). Nothing in it is written for Bea.

## 3. Open questions

### G1. The purpose

Options:
1. **Section 1 as written:** two people and the hand-off between them, done only when a ship has reached Bea.
2. **#1317's R1 purpose:** the same four people, plus "one product" as a separate outcome, with each person's path judged on its own.

Pick: 1. Thomas's quote names the connection between the two kinds of people as the advantage; judging each path alone can pass while the hand-off fails, as F1 did.

### G2. The pause for a commercial plan

Context: Thomas paused #1317 on 31 Oct until a commercial plan exists. No commercial plan is in the repository or the issues.

Options:
1. **Agree the purpose now; detailed design and screens wait** for the plan, or for Thomas to lift the pause.
2. **Go on to the detailed design** once the purpose is agreed.
3. **Wait** with the purpose too.

Pick: 1. The purpose names who gets in and what flawless means, which a commercial plan informs but does not replace; screens are where a plan could change the answer.

### G3. This design and #1317

Options:
1. **This design replaces #1317's onboarding design;** its answers Q1 to Q10 stay lessons (section 2.1), its journeys are read again in stage 2, and #1317 closes once this purpose is agreed.
2. **Continue on #1317,** this file merged into `design/onboarding`.

Pick: 1. #1317 predates Bridge and the approved computer setup; one current file is easier to approve than a restart of a restart.

### G4. Who the design starts from

Context: Thomas's Q4 answer was "design for the technical person first".

Options:
1. **Keep Q4, judged by the pair:** design Ada's path first, but no part counts as done until a walk of Ada then Bea passes.
2. **Both paths designed together.**
3. **Keep Q4 as it was:** Bea's path designed after Ada's is done.

Pick: 1. Ada's path comes first in time, since Bea cannot get in before a fleet and a ship exist, and the pair walk keeps the hand-off in view.

### G5. Where Bea lands

Context: Bridge, approved after #1317, is the person's default place. The audit walked the gateway's pages and a chat client through the gateway's MCP.

Options:
1. **Bridge:** the invite leads to Bridge; Slack or a chat such as claude.ai is offered there, after her first answer.
2. **Her choice first:** the invite asks where she wants her items before she sees any.
3. **The gateway's pages,** as walked.

Pick: 1. One place to arrive, already designed for her; a choice before she has seen an item is a question she cannot answer yet.

### G6. Who starts

Options:
1. **Either:** the founder signs up and invites Ada, or Ada signs up and invites Bea; both entries are walked.
2. **Ada always signs up first.**

Pick: 1. A non-technical founder signing up is the likely first contact for a company; that entry must hand the technical part over without a dead end.

### G7. The measure of flawless

Options:
1. **A fresh pair walk on staging at the release under test:** no friction ranked Blocks or Hurts, each Rough one filed.
2. **Option 1 plus a time budget:** Ada to her first answered message and Bea from the invite to her first answer, each within a time Thomas sets.
3. **Zero frictions of any rank.**

Pick: 1. It is the gate Thomas set in Q1; a time budget depends on installs and model speed outside Aeolus, and zero Rough frictions would block on taste.

### G8. Walk again before the detailed design

Context: the audit is at 0.31.0; most frictions are closed since, untested together.

Options:
1. **Walk the pair again on staging now** (Claude Code, as #1317's R6), and design from that walk.
2. **Design from the issue statuses in section 2.2.**

Pick: 1. Section 2.3 shows fixes passing in core while the fresh path still failed; a design built on closed issues risks repeating that.
