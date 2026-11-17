# Hosted onboarding: mockup coverage and slice acceptance

Status: all nine picks are decided. These mockups await approval. [Open the review index](artboards/index.html). Each screen sheet renders every listed state before and after at **375 × 812** and **1440 × 1000**. Desktop is scaled only by the sheet, not by the artboard. Open an artboard directly for full size or another width. Before views are reconstructions from [the staging walk](../walk.md), not screenshots of deployed apps. An unobserved failure uses the existing design-system state, not a claim that the failure was observed.

The artboards are static, with inert controls. They issue no requests and contain no credentials. Copy, loading, submission, failures and completion are separate linked frames. The review strip and sheet navigation sit outside the product frame. `success` on a data view means loaded content, not a completed mutation; the question additionally has `answer-pending` and `answered`.

## Screens and states

| Mockup | Screen and before/after sheet | States at both widths | Decision and path |
| --- | --- | --- | --- |
| M01 | [Home](artboards/sheet-01.html) | Ready, copied, clipboard failure | Q3, Q6; all personas |
| M02 | [Quick start](artboards/sheet-02.html) | Ready, copied, clipboard failure | Q3, Q6; all paths |
| M03 | [llms.txt](artboards/sheet-03.html) | Ready text | Q3; agent entry |
| M04 | [Start page](artboards/sheet-04.html) | Ready HTML/Markdown representation, missing page | Q1-Q3, Q6-Q9; all paths |
| M05 | [Path guides](artboards/sheet-05.html) | G and B1-B4, D1-D2, F1 each: ready, copied, clipboard failure | Each guide names its first value and next path |
| M06 | [Sign in](artboards/sheet-06.html) | Empty email, loading, failure, check mail, expired link, rate limited | Q7; G and D1 |
| M07 | [Fleet name](artboards/sheet-07.html) | Empty, loading, failure, fleet ready | Q8; G |
| M08 | [Waiting list](artboards/sheet-08.html) | Cap reached; timing visibly open | Q7; G stops |
| M09 | [Account home](artboards/sheet-09.html) | No fleet/rights, loading, failure, fleet ready, added Decider without rights | Q8, Q9; G, D1 |
| M10 | [Fleet overview](artboards/sheet-10.html) | No agents, loading, failure, crewed, awaiting crew | Q1, Q8; B1, B2, B4, F1 |
| M11 | [Settings plugins](artboards/sheet-11.html) | No connection, loading, failure, connected, later disconnected | Q8; G, B4 recovery |
| M12 | [Commission ship](artboards/sheet-12.html) | Empty, loading, failure, commissioned, no permission search matches; B1 and B4 rights variants | Q1, Q2; B1-B4, F1 |
| M13 | [Starting prompt](artboards/sheet-13.html) | Already issued/not retained, issuing, failure, shown once, already crewed | Q6; B1-B4, F1 |
| M14 | [Bridge waiting on you](artboards/sheet-14.html) | Empty, loading, failure, question waiting, gateway disconnected, steering notice | Q8, Q9; B1, D1, F1 |
| M15 | [Bridge question](artboards/sheet-15.html) | Empty, loading, failure, open, sending, answer not sent with choice retained, answered | Q9; B1, D1, F1 |
| M16 | [Welcome](artboards/sheet-16.html) | Welcome names builder; expired link | D1; existing identity model |
| M17 | [People and groups](artboards/sheet-17.html) | Empty, loading, failure, rights saved, unsaved membership and rights | Q9; builder’s side of D1 |
| M18 | [Demo question](artboards/sheet-18.html) | Empty, loading, unavailable, open, sending, answer not sent with choice retained, answered and scripted continuation | Q4; D2 |
| M19 | [Trierarchs](artboards/sheet-19.html) | No computer, loading, failure, ready, offline, setup interrupted | Q1, Q2, Q8; B4 |
| M20 | [Ship page and timeline](artboards/sheet-20.html) | No events, loading, failure, crewed and first work returned, scope refused | Q1, Q2; B2, B4, F1 |
| M21 | [Ship exchange](artboards/sheet-21.html) | Empty, loading, failure, reply received, delivery/answer waiting | Q3 paths; B2, B3, F1 |
| M22 | [Chat guidance](artboards/sheet-22.html) | Guide text, loading, connector failure, answer received | Q6, Q9; D1’s chat alternative |
| M23 | [Terms](artboards/sheet-23.html) | Not accepted, submitting, failure, accepted | G before fleet naming; existing terms |
| M24 | [Computer setup](artboards/sheet-24.html) | No line issued, issuing, failure, shown once, interrupted | B4; existing computer setup |
| M25 | [Added email](artboards/sheet-25.html) | Builder named; expired link | D1 before welcome |

Static documents, mail and the waiting-list notice have no runtime data empty/loading states. M01-M05 are built from the site’s path source, so an empty persona set or broken anchor is a build failure rather than a new product screen. M04 shows the existing missing-page fallback. M06-M07 and M10-M13, M17, M19-M21 are shared path dependencies: their existing jobs remain, with the guides pointing to them. Their before/after views make that reuse explicit. Q5 changes PR disposition, not a screen; no product UI is invented for it. Q2’s future template and Q9’s future add-account rights offer are follow-up issues, not current mockups.

## Real parts and provenance

`screens.jsx` imports the checked-out components; `parts.jsx` is a narrow export barrel pointing directly to the real package files, not substitute components. Generated HTML retains the real parts’ markup and classes. Styling uses `packages/ui/src/theme.css` and its imported tokens; `layout.css` composes the documentation frames around those parts.

- Every control: `packages/ui/src/atoms/button.tsx`, `input.tsx`, `checkbox.tsx`; errors, empty and loading: `packages/ui/src/molecules/{inline-error,empty-state,loading-skeleton}.tsx`; statuses: `status-badge.tsx`.
- Console chrome: `packages/console/components/organisms/{sidebar,top-bar,tab-bar}.tsx` with `packages/ui/src/organisms/app-header.tsx`, AppSwitcher and AvatarMenu. The console’s real brand assets are included.
- Crew and source text: console `components/atoms/code-block.tsx`, `copy-button.tsx`, `components/molecules/crew-lines.tsx` and `live-status.tsx`.
- Permissions: console `components/molecules/permission-choices.tsx`. Steering’s chosen rights are read, commission and manage, in addition to send/receive. This is a guide to manual commission, not a new preset.
- Questions in M15 and M18: console `features/inbox/ui/organisms/question-reader.tsx`, with its existing desktop and phone variants. Q4 uses the planner’s time-zone question from the hosted demo’s `demo/questions.ts`. Its answer and subsequent scripted report are illustrative. No new question interaction is designed here.
- Site, account and Bridge page bodies compose the shared parts to show the design. These are not imported pages from those other repositories. The overview uses the real `packages/ui/src/organisms/harbour.tsx` and its group/tile parts with fixture props. Timeline/exchange content composes shared parts; it does not implement a live data layer. Behaviour is [design sections 4-7](../README.md#4-the-paths); look follows [the design system](../../README.md).

## Numbered persona paths

Numbers are the walk order. Each link opens before/after and both widths, with recovery states on that same sheet. The equivalent guide has numbered Person, Agent or App steps in M05. Paths can be picked independently; this is not a forced linear tour.

### G. Get a fleet, shared by Builder and Flow owner

1. [M01/M02](artboards/sheet-01.html): pick a path or copy the agent prompt; agent starts at [M03](artboards/sheet-03.html), then [M04](artboards/sheet-04.html).
2. [M05 G](artboards/05-path-guide-g-after-ready.html): person/agent hand-off; [M06](artboards/sheet-06.html): email, mail, expired/rate-limit recovery.
3. [M23 terms](artboards/sheet-23.html), then [M07](artboards/sheet-07.html): terms and name, fleet made with enabled plugins connected. Cap reached goes to [M08](artboards/sheet-08.html) and stops.
4. [M09](artboards/sheet-09.html), then [M10](artboards/sheet-10.html): fleet ready, argo and person ship. Existing later-disconnected fleets recover through [M11](artboards/sheet-11.html).

### B1. Builder: an agent asks a question

1. [M05 B1](artboards/05-path-guide-b1-after-ready.html): install in Claude Code or Codex; run G if needed.
2. [M12](artboards/sheet-12.html): commission; [M13](artboards/sheet-13.html): copy only into the crewing session. Used/old line or conflict returns to the existing new-prompt action.
3. [M14](artboards/sheet-14.html): Bridge opens, empty until the agent asks. Disconnected error names the fleet manager and Settings.
4. [M15](artboards/sheet-15.html): read, send answer, see answered; the agent acts. Guide offers B2.

### B2. Builder: agents hand work to each other

1. [M05 B2](artboards/05-path-guide-b2-after-ready.html), [M12](artboards/sheet-12.html), [M13](artboards/sheet-13.html): commission and crew second folder.
2. [M10 awaiting crew](artboards/10-fleet-overview-after-awaiting-crew.html): a task waits before that ship crews.
3. [M21](artboards/sheet-21.html): first ship sends, second acknowledges and replies. Wrong name is refused; agent uses discover as section 4 says.
4. Restart second session, send while down, crew it again; waiting becomes received/replied. Guide offers B4 or B3.

### B3. Builder: own app sends work

1. [M05 B3](artboards/05-path-guide-b3-after-ready.html), [M12](artboards/sheet-12.html), [M13](artboards/sheet-13.html): commission app ship.
2. The guide and [M01 REST block](artboards/01-home-after-ready.html) name register before send, JSON content type, model and where the token comes from. App keeps its own token.
3. [M21](artboards/sheet-21.html): send, agent acts, reply received/acknowledged. Scope/reach refusals follow design section 4; no hand-off occurs on refusal. Guide offers F1.

### B4. Builder: steering ship builds the fleet

1. [M05 B4](artboards/05-path-guide-b4-after-ready.html), G, then [M19](artboards/sheet-19.html) and [M24 setup](artboards/sheet-24.html): join own computer; interrupted/offline states remain visible.
2. [M12 B4](artboards/12-commission-ship-b4-after-success.html): commission steering by hand, with the Q1 rights listed in the guide. [M13](artboards/sheet-13.html): crew the current session.
3. Steering commissions a second ship and requests crew on that computer. [M10](artboards/sheet-10.html): awaiting crew becomes crewed; [M19](artboards/sheet-19.html): offline computer leaves requests waiting.
4. [M20](artboards/sheet-20.html), [M21](artboards/sheet-21.html): new ship hands work back; commissioner and owner are visible on its page. [M14](artboards/sheet-14.html): steering’s existing notice route; no new notice surface.
5. [M20 scope refused](artboards/20-ship-page-and-timeline-after-scope-refused.html) and [M15](artboards/sheet-15.html): outside rights, fleet changes nothing and steering asks the person. Existing console release/re-crew/retire/permission actions remain usable by the person. Guide offers D1.

### D1. Decider: added by a builder

1. Builder follows [M05 D1](artboards/05-path-guide-d1-after-ready.html) and [M17](artboards/sheet-17.html): add email, group membership, Talk with the fleet, Save rights. The guide explains these existing controls.
2. Decider opens [M25 email](artboards/sheet-25.html), then [M16](artboards/sheet-16.html): builder named; expires in 15 minutes, request another link if needed.
3. [M09 no rights](artboards/09-account-home-after-no-rights.html): names precisely what to ask the builder for. No terminal, id or JSON.
4. [M14](artboards/sheet-14.html), [M15](artboards/sheet-15.html): answer a real question in Bridge; loading and read failure keep the page visible rather than blank. Or [M22](artboards/sheet-22.html): own chat through gateway connector, the same question and answer.
5. Agent receives answer and continues. Guide offers F1 with the builder.

### D2. Decider: alone

1. [M01/M02](artboards/sheet-02.html): choose the demo; [M05 D2](artboards/05-path-guide-d2-after-ready.html) explains no account or terminal is required.
2. [M18](artboards/sheet-18.html): question per visit, answer pending, answered, scripted ship carries on with that answer. If unavailable, try later or ask a builder; no new sign-up branch.
3. M18’s next-path line says what to ask a builder: add the visitor’s email and save Talk with the fleet rights, then D1.

### F1. Flow owner: one flow connected

1. [M05 F1](artboards/05-path-guide-f1-after-ready.html): name the flow’s app, agent and person; G if needed.
2. [M12](artboards/sheet-12.html), [M13](artboards/sheet-13.html): commission and crew the non-person steps through B1 and B3.
3. [M21](artboards/sheet-21.html): app sends; agent asks; [M15](artboards/sheet-15.html): person answers; agent hands on. A waiting answer stops the flow visibly; an uncrewed ship leaves delivery waiting on [M10](artboards/sheet-10.html).
4. [M20](artboards/sheet-20.html), M21: inspect each hand-off on the existing ship pages and exchanges. No combined flow monitor. Guide offers D1, then B4.

## Slice order

Each row is one thin PR in the named repository. All relevant states, before/after pairs and both widths on the linked sheets are its visual acceptance criteria, alongside the named design scenarios. Existing screens listed as dependencies are reused, not rebuilt. Follow-up template and add-account rights changes remain outside these slices until their separate issues are approved.

| Order | Repository and result | Screens and visual acceptance | Scenarios and dependency |
| --- | --- | --- | --- |
| 1 | site: one path source for G, B1-B3 and agent entry | M03, M04, M05 G/B1/B2/B3; M01/M02 prompt line only | A1, A3, A14; source commands from guides |
| 2 | site: persona picker on Home and Quick start | M01, M02, M05; copied and clipboard-failure frames | A2, A3; after 1 |
| 3 | site: correct REST example and B3 hand-off | M01 REST block, M05 B3; M12/M13/M21 reused | A6, A15; after 1; independent of picker |
| 4 | hosted app: enabled plugins connect when fleet is made | M23 accepted, M07 success, M09 success, M10, M11 connected; failed provisioning retains error frame | A4, A7, A15; Q8; shared setup before B1/B4 release walks |
| 5 | aeolus-fleet-gateway: disconnected Bridge names recovery | M14 disconnected/error/loading/ready; M11 recovery reference | A4, A15; gateway#405; no automatic reconnect |
| 6 | account app: waiting-list and path stop copy | M08, M05 G; M06 cap-path dependency | A15; Q7 timing copy approval required |
| 7 | site: D1 guide for builder and chat-guided Decider | M05 D1, M17 existing membership/save states, M22 | A10, A11; Q9 names steps, does not grant automatically |
| 8 | account app: welcome names builder and no-rights home names request | M25 email, M16 ready/expired, M09 no-rights; M06 recovery | A10, A15; after 7’s agreed wording |
| 9 | aeolus-fleet-gateway: added Decider can open and answer | M14, M15 all states, M22 answer received | A10, A11; gateway#404; after rights saved |
| 10 | site and fleet guide: F1 path and hand-off reading | M05 F1; M10/M12/M13/M15/M20/M21 reused, including waiting states | A13, A14; after B1/B3 and D1 where used |
| 11 | site: B4 manual starter instructions, bounded rights, computer first | M05 B4; M19 ready/offline, M24 setup/interrupted, M12 steering permissions, M13, M10 awaiting/crewed, M20 scope refusal and timeline, M14/M15 notice/question route | A7, A8, A9, A14; Q1/Q2/Q8; existing computer setup and #1899 released on staging |
| 12 | hosted app: per-visit demo question and scripted continuation | M18 all states and next-path line; M01/M02 D2 card, M05 D2 | A12, A14, A15; Q4; illustrative copy approval required |
| 13 | site: publish complete path set and walk both harnesses | M01-M05 all paths; M06-M25 as cross-train dependencies | A1-A15 staging walks, Claude Code and Codex; no additional product feature |

Q5 is a repository action: close #1317, merge #1232. It has no visual acceptance and is not performed by this mockup-only PR.

## Open copy points for approval

1. **Q7 timing:** `[timing: Thomas decides]` is deliberately visible in M08. No promise or contact mechanism is invented.
2. **Q4 demo copy:** the question comes from the demo’s own scripted flow. Its answer/continuation text is illustrative, to be approved with M18. Existing QuestionReader interaction is reused.

3. **Path times:** `[checked-walk estimate to approve]` is visible on paths without an approved estimate. B1 uses its existing 15-minute acceptance target.

Path cards show needs and first value. Durations beyond the B1 acceptance target are not specified in the design; the cards reserve an explicit checked-walk time line rather than invent estimates. `/start` and the picker must use the same approved value from the one source.

## Reproduce the artboards

Open `artboards/index.html` directly in a browser; no build is needed to review. `artboards/manifest.json` lists every before/after state. `sheet-01.html` through `sheet-25.html` pair real phone/desktop iframe viewports. Source is only mockup rendering under this folder, never imported by a package.

To regenerate from the current checkout, install the isolated rendering tools with npm outside the repository, then run from the repository root:

```sh
npm install --prefix /tmp/aeolus-1228-mockup-tools --no-audit --no-fund react react-dom esbuild @base-ui/react class-variance-authority clsx tailwind-merge lucide-react tailwindcss @tailwindcss/cli next
MOCKUP_TOOLS=/tmp/aeolus-1228-mockup-tools node docs/design/hosted-onboarding/mockups/build.mjs
```

The narrow barrel avoids bundling unrelated parts. React server-rendering and Tailwind produce committed standalone HTML/CSS; generated JavaScript is removed. Rebuilding after package changes intentionally reflects those real parts.

## Validation

264 before/after artboards across 25 screens, each checked in Chromium at 375 and 1440 pixels: 528 viewport checks, no horizontal overflow or missing brand assets. The final G timing-slot and demo-unavailable copy were rechecked at both widths. Local artboard and coverage links resolve. Home and demo before/after PNG previews at both widths are in `previews/`. Production tests, lint and typecheck were not run: no package code or tests changed.
