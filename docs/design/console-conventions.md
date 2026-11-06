# Aeolus console conventions

Rules only the console has: its parts, pages and actions. The rules for every app are in [conventions.md](conventions.md); these add to them.

## Colour
- Tone families only via StatusBadge, ReportLine, HealthIndicator, StationProgress, HarnessUnknown, alerts and count badges. Never on buttons, text blocks or layout.
- Mapping outside a ship's state: Pending, Forming, Late, seen long ago → waiting. Handed (pulled), Standing down → active. Acknowledged, Sailing, On time, seen fresh → ok. Undeliverable, Silent → attention. Dismissed, Abandoned, Disbanded → ended; Abandoned has a dashed border; Not on station is a dashed ring and seen a while ago is muted, no tone.
- `--highlight`: a just-added row (fades over `--duration-highlight`) and the operator kind chip. Nothing else; the flagship kind chip is neutral.

## Components: which one
- argo: first in FleetTable; its type (operator) in a kind chip; row opens OperatorInbox; menu only Open inbox and Copy ship id; never Release, Rename, Retire, starting prompt, report or model; runs on "Console · Device"; excluded from SelectorPicker, CommandPalette ships and overview metrics; as a party "argo (you)".
- ReportLine on every other ship: FleetTable Report column, ShipHeader under the title. No report: "No report yet". Retired ships: none.
- FleetTable row: one `--size-row` line. Columns: Ship (ShipName plus a kind chip: the type of every ship that is not an agent, viewer, flagship, or plugin for an agent a plugin runs as), Status, Report (ReportLine or the one existing next step, time in title), Squadron and labels, Runs on, Seen (when the session was last heard from in Harbour's time words, "Last seen 25 s ago" in title), row menu. The columns share the page's width as docs/design/fleet-overview draws them, never scrolling sideways; metadata never stacks under the name. Sort arrows show only on the sorted column and under the pointer or focus. Phone row (fleet-overview, 375): name and row menu, Status with the type chip, the report, then "Claude Code · Device · 4 min" in words. A member's SquadronTag appears once in its own cell, role in its title and on the ship/squadron page. Omit matching squadron and squadron-role label chips only when membership is available; the assigned labels and exact-match filters stay unchanged. Other labels occupy one line with +n linking to the ship page, full folded values and owners in its title. Awaiting ships show prompt status on the ship page. Crew request remains a filter and ship-page detail, with no overview column. Type is a filter; open deliveries and last ping live on the ship page.
- A plugin ship shows where it does something: Ping, its report (ship page, the FleetTable Report column and its sort) and a command palette entry, as an agent ship; never in Compose, the crew request or the overview counts.
- FleetTable actions: all in the row menu. At most one next step in the Report cell, only: Awaiting crew → "Get the starting prompt" as plain muted words (fleet-overview), silent member → Get new crew line (Button, secondary, xs; phone full width).
- Row menu: crewed: Message this ship…, Copy ship id, Ping, Re-crew…, Release ship…, Rename…, Retire ship…. Awaiting crew: Get starting prompt… in place of Ping, Re-crew, Release. Member: Ping, Get new crew line…, Release ship…, Remove from squadron…, no Rename or Retire. Flagship: Open squadron only. Retired: Copy ship id.
- FleetTable Runs on: current session only, LocationTag with harness and location kind followed on the same desktop line by a quieter muted mono model hint. The hint truncates before the location and exposes the full exact model/package and stated time in its accessible text and desktop Tooltip. No model stated: show nothing in the overview. Awaiting crew, retired and viewer: empty Runs on, no prompt status, trierarch assignment or retired date. argo has no model.
- ModelTag outside FleetTable: the value exactly as the session stated it, stated time in title. Starts with @ or ends in @x.y.z → software (package mark, dashed outline); otherwise a model (sparkles mark). Empty for argo and ships without a session; "Not stated yet" for a crewed ship that has not stated one.
- FleetScopes: edit in CommissionForm, both off; read-only in the ShipHeader meta strip, "None" when empty.
- StartingPromptBlock always shows a CrewLineBlock per harness under the prompt, in the order core issues them: Claude Code, Codex, Copilot.

## Squadrons (only when enabled)
- Off: no Squadrons destination, Squadron filter, flagship chip, squadron states, health or silent members. Nothing else changes.
- On: Squadrons second in Sidebar and TabBar (TabBar gets 5 tabs); Squadron filter in the FleetTable toolbar and phone filter Sheet; CommandPalette adds squadrons, blueprints and squadron actions.
- Member name: the ship name as is; a squadron may prefix names but the console never parses them. Membership shows as SquadronTag, from the squadrons API.
- Flagship: like argo, never Release, Rename or Retire; its only action is Open squadron; retires when its squadron disbands. Message on a squadron goes to its flagship.
- Member: no Rename. Retire → Remove from squadron (RemoveMemberDialog). Get starting prompt → Get new crew line (CrewLineDialog). Silent: Get new crew line is the primary action.
- Crew lines carry the secret: CrewLineBlock shows them once, with the template's launch note; afterwards only "Crew line issued … not claimed yet".
- Forming: FormSquadronDialog (blueprint and version, then preview) → squadron page in Forming: StationProgress plus crew lines in MemberList rows. All on station: Sailing, Toast "<id> is sailing".
- Health only on members: HealthIndicator, dot plus word. Silent = 3 missed check-ins; only silent members go to Health, without a count. Late and Blocked stay on the squadron page.
- Blueprints and templates are read-only (BlueprintTable, BlueprintView, TemplateTable, TemplateView): show source file and commit, never edit controls.
- UpgradeBlueprintDialog lists every change per member and per hand-off.
- Disbanded squadrons hide behind "Show disbanded (n)", like retired ships, and keep a read-only page.

## Crew requests and trierarchs
- "Requested by" on a crew request names the actor of the ship's latest `CrewRequested` event, from its timeline; no stored field holds it. argo reads "you".
- The Trierarchs sidebar count is silent machines only. Requests no trierarch can take already show on Needs crew; they are not counted twice.
- A harness a trierarch cannot serve shows as a NotOfferedLine (warning icon, attention tone, "Codex not offered", the reason, "Clears itself once the plugin is back.") on its MachineCard and on its Health machines row. It does not change the Trierarchs count, which stays silent machines only.
- Commissioning: Request a crew is on by default while the trierarch plugin is connected, off otherwise.

## Network
- Export and import sit in their own section after Apply: Export (secondary) downloads the applied rules as `network-rules-<fleet>-v<version>.json` and confirms with a Toast; the rules it left out (a label or ship the fleet no longer has) stay listed in the section, each with why, in the waiting tone; Import… opens ImportNetworkRulesDialog, offered only to a session holding labels:define beside fleet:network.
- ImportNetworkRulesDialog (form Dialog, phone full screen) numbers its four steps at the top: 1 Attach or paste (a file input, or a mono Textarea), 2 Check (Check file; a failed check is an InlineError naming each break, the text kept), 3 Overview, 4 Import. The fleet reads and checks the file; the console only sends its text.
- Overview: a checkmark line with what the file holds (rules, labels, fleet, rules version, when exported); then the differences, one NetworkRulesDifferenceField each (what differs as its headline, its ways as a RadioGroup, a ship Combobox for a pick); then the definer of the labels import creates, a ship Combobox with argo preselected; then every rule as one mono line by name. Import… stays disabled until every difference is resolved.
- Import confirms inside the dialog (Import into the draft?): the draft replaced, the labels defined and for whom, nothing in force until apply. Success closes the dialog with a Toast and the draft's changes show on the page; a failure is a section InlineError whose Try again checks the file again.

## Destructive actions
- No confirm: Ping, Mark done, Answer (its button names the option it sends), Mark as unread, Resend, Dismiss, Get new prompt (the dialog states the old one stops working), Sign out.
- Normal confirm (Dialog, phone bottom Sheet): Get new crew line, always (it says what the new line ends: a session or an unclaimed line); Release; Retire or Remove from squadron with no open deliveries; Stand down; Force stand down with no open work; Upgrade blueprint (primary button); Rename (the dialog is the confirm).
- TypedConfirm only when an irreversible action discards pending work: Retire with open deliveries (type the ship name); Remove from squadron with open deliveries (type the ship name); Force stand down with open work (type the squadron id).

## Copy
- Terms (UI copy only; code keeps the blueprint terms): ship, commission, crew, crewed, awaiting crew, release, retire, starting prompt, crew line, re-crew, ping, report, harness, model, last seen, fleet scope, delivery, pending, handed (pulled), acknowledged, undeliverable, dismissed, abandoned, operator, argo. Squadrons: squadron, flagship, member, role, blueprint, template, charter, launch note, check-in, form, on station, sailing, stand down, disbanded, hand-off. Not: lease, revoke, rotate, user, agent (except "agent session"), team, deploy.
- ShipName: add ` · XXXX` (last 4 id characters) in ShipTimeline, DeliveryHistory, retired ships, and a message header's parties when another ship of the fleet had the same name. Never in inbox rows, never for argo.
- Type address: Badge type chip in mono; prose "Any ship of type reviewer"; short "any reviewer".
- LocationTag text: `<Kind> · <description>`. With a harness (FleetTable): `<Harness> · <Kind>`, description in title; claude-code, codex, copilot, claude-chat, chatgpt, grok, grokbot and console show icon plus Claude Code, Codex, Copilot, Claude chat, ChatGPT, Grok, Grokbot, Console; any other harness plain text as stored.
- Versions: blueprints "v4", templates "tester@4", commits short (`4f2a91c`).

## Responsive
- Phone swaps: MemberList → role groups of cards; Sidebar → TabBar; Sidebar account button → TopBar Avatar opening AccountMenu; Header → TopBar; Table → list rows (FleetTable: wrapping name and menu; status and kind chip; membership on its own line; report or next step; runs on with muted model hint (may follow the location) and seen. Labels remain on the ship page; selected label filters stay visible); DropdownMenu → bottom Sheet; form Dialog → full-screen page; confirm Dialog → bottom Sheet; side Sheet → pushed page, delivery first; two-pane OperatorInbox → list + page with pinned reply, TabBar hidden; filters → bottom Sheet; Toast above TabBar.
- Signed-out pages sit in SignInLayout; signed-in pages render ListPage or DetailPage inside the ConsoleFrame; no other skeleton.

## Accessibility
- StationProgress is a `progressbar`; its changes are announced politely.
