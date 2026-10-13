# Fleet overview table proposal

## 1. Purpose, ranked

1. Identify the ship. Its complete name has first claim on space; only the name opens its page (argo opens the operator inbox).
2. See whether it is crewed, awaiting crew or retired. Keep these separate from Working, Blocked and Idle, which are the crew's reports.
3. Spot the existing next step: Get starting prompt for an awaiting ship, Get new crew line for a silent member. Needs attention keeps its existing card, count and page; a blocked report or an old LastSeen does not create an attention entry.
4. Read what the crew reports, with a consistent state icon and word followed by a short, neutral note.
5. Recognise squadron membership and useful labels without competing with the name.
6. See the session's harness, location kind and recency. Exact model, package version, trierarch assignment, crew-request stage and reason, prompt history, full report, scopes and deliveries belong on the ship page. Desktop Tooltips may repeat these details, never replace access on that page.

## 2. Proposal

| Column | Cell |
| --- | --- |
| Ship | ShipName, weight 500. Operator, viewer, flagship or plugin Badge only. No labels or member role beside the name. Retired names retain their id suffix. |
| Status | StatusBadge: Crewed, Awaiting crew, Retired. Never infer work from the session's turn or its recency. |
| Report | ReportLine: state icon and word in its tone, note in foreground, one line with overflow truncation. Full note and report time in desktop Tooltip and on the ship page. No report: muted “No report yet”. Empty for argo, viewer and retired ships. Awaiting ships and silent members keep their existing single next-step Button. |
| Squadron and labels | A separate, bounded cell. SquadronTag once, from the squadrons API, with role in its Tooltip and on the ship/squadron page. Do not repeat the matching squadron= value or squadron-role as another chip; the complete assigned labels remain on the ship page and in exact-match filtering. Other LabelChips: one line, as many whole chips as fit, then +n. The overflow count opens the ship's labels section, with a desktop Tooltip repeating all labels and owners. No semantic parsing of the ship name. |
| Runs on | LocationTag only: harness and location kind of the current session. Description in Tooltip and on the ship page. No trierarch name or prompt status here. Empty without a session and for viewer; argo keeps Console · Device. |
| Seen | LastSeen, its existing three signal shapes and thresholds, exact time accessible and in a desktop Tooltip. Empty without a session. |
| Actions | One ghost Button and existing DropdownMenu; bottom Sheet on phone. Preserve every current action and permission. |

Remove the Model and Crew request columns. This is a proposed change to FleetTable composition, not a change to ModelTag's meaning or the crew-request lifecycle. Exact model and “Not stated yet” remain on the ship page. CrewRequestCell, status, assignment, settings and reason remain on the ship page and Needs crew. Filters still make requests findable without a column of dashes. Prompt status moves to the awaiting ship's page, never masquerades as a location.

Desktop uses the Table's 40 px header, 48 px rows and 16 px horizontal cell padding. Ship has a reserved width; metadata gives up space first. At narrower desktop widths allow horizontal table scrolling rather than reducing names to two letters. Very long names can truncate only after that reservation, with full name on focus/hover and the ship page. At 640 to 1023 px the existing rail still applies.

**States:** Crewed is the green StatusBadge even with no report. Working uses the blue ReportLine; Idle uses the ended tone; Blocked uses waiting, not attention. Awaiting crew uses waiting and the existing starting-prompt action (members use their existing crew-line action). Silent members retain Crewed and show Get new crew line with the existing silent indication; other attention reasons stay on Needs attention, with no invented row status. Retired uses ended, no session metadata or report, suffix and Copy ship id only; hidden by default. The mockup includes one retired row to show the treatment.

**Phone:** below 640 px, list rows replace the table. Full name and menu first; kind and StatusBadge on their own line; ReportLine or next step next; LocationTag and LastSeen last. Member SquadronTag has its own line. Keep current phone label policy: labels live on the ship page, selected label filters remain visible. Long names wrap; no hover requirement, all actions have 44 px targets. Filters use the existing bottom Sheet.

**Filters:** no semantic changes. Keep search by name/type, Status, Crew request, Type, Squadron when enabled, Labels (exact values combined with AND), Show retired, selected values and clear actions. In the mockup the toolbar is a static representation, not a filtering implementation. Counts above retain their definitions and destinations, excluding argo/viewer from ship metrics. No automatic reorder under the pointer.

**Concrete parts:** Table, ShipName, Badge, StatusBadge, ReportLine, SquadronTag, LabelChips, LocationTag, LastSeen, Button, DropdownMenu, Tooltip, Sheet, Select, Switch. Use the existing tokens; slate blue primary is reserved for brand and primary actions. Status colour always has shape and words. Every link and enabled control has a pointer and visible focus.

## 3. Mockup

Open [mockup.html](mockup.html) from this checkout, or serve the repository root. It imports the single source of tokens from `packages/console/app/tokens.css`. Four fixed compositions show desktop light/dark and phone light/dark together, with no JavaScript or backend. Example reports, times, squadron id, labels and models are illustrative, not a copied live fleet snapshot. Model is intentionally absent from the overview.

Scope: proposal files only. No console implementation, product rules, PR or design-system rule edits. Before implementation, reconcile this proposed composition with the FleetTable and phone label conventions in the design source. Model/crew-request removal and moving membership out of the name cell are explicit design changes proposed for Thomas's review.
