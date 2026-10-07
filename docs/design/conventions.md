# Aeolus console conventions

Rules for cases the Design system page does not show. Names = parts and tokens on that page. Screens are reference; on conflict the Design system page wins.

## Stack
- shadcn/ui on Base UI, Lucide, Tailwind v4 with CSS variables; dark = `.dark` on `<html>`.
- Every value is a token. Arbitrary values only as token references, e.g. `w-(--size-sheet)`.
- Wrap shadcn atoms; never fork their behaviour. No new atom when shadcn has one.
- Every clickable control (buttons, links styled as buttons, menu and select items, tabs, checkbox, switch) shows `cursor: pointer`, set once in the base CSS layer; a disabled one shows the default cursor.

## Colour
- Brand accent = `--primary`: primary Button, active nav item, open-message counts, active TabBar item. Nothing else.
- `--accent` = neutral hover and selected surface (shadcn meaning), never brand.
- Tone families (`--tone-{waiting|active|ok|attention|ended}-{bg|fg|border}`) only via StatusBadge, ReportLine, HealthIndicator, StationProgress, LastSeen, alerts and count badges. Never on buttons, text blocks or layout.
- Mapping: Awaiting crew, Pending, Forming, Blocked, Late, seen long ago → waiting. In flight, Standing down, Working → active. Crewed, Acknowledged, Sailing, On time, seen fresh → ok. Undeliverable, Silent → attention. Retired, Dismissed, Abandoned, Disbanded, Idle → ended; Abandoned has a dashed border; Not on station is a dashed ring and seen a while ago is muted, no tone.
- Status is never colour alone: icon + label always; the live dot always has its word.
- Alert tone: error → attention; warning or rate limit → waiting; neutral fact → ended; calm notice (signed in elsewhere) → `--muted` panel.
- `--destructive` fills only the final confirm Button. Destructive menu items and field errors use `--destructive-text`.
- `--highlight`: a just-added row (fades over `--duration-highlight`) and the operator kind chip. Nothing else; the flagship kind chip is neutral.

## Spacing and density
- `--spacing: 4px`; use only steps on the page: spacing-0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12.
- Icon to text: spacing-1.5 in badges and meta, spacing-2 in buttons. Between buttons: spacing-2.
- Desktop page: padding spacing-6 vertical, spacing-8 horizontal; section gap spacing-5; card padding spacing-4.
- Phone page: gutter spacing-4; section gap spacing-3.5; list row padding spacing-3 by spacing-3.5.
- Dialog padding spacing-6; field gap spacing-4.
- Table: header `--size-row-header`, row `--size-row`, cell padding x spacing-4, one row action (ghost icon Button, xs) in the last column.
- Controls: desktop `--size-control` (toolbar and header `--size-control-sm`, row actions `--size-control-xs`); phone always `--size-control-touch`.

## Typography
- Page title `--text-title` (desktop h1, phone root TopBar). One per page.
- Ship name on its page: `--text-title` desktop, `--text-title-touch` phone.
- Dialog, Sheet and EmptyState titles: `--text-heading` desktop, `--text-heading-touch` phone.
- Section title `--text-section`.
- Body `--text-body` desktop, `--text-body-touch` phone; phone inputs `--text-input-touch`.
- Metadata, help, timestamps: `--text-meta` in `--muted-foreground`.
- Badges, column headers, counters: `--text-caption`. Counts, Kbd, TabBar labels: `--text-micro`.
- Ids, id suffixes, types, roles, scopes, template refs (`tester@4`), model ids and packages (ModelTag), commands: `--text-id` (mono). Payloads, prompts, crew lines, charters: `--text-code`.
- Overview numbers `--text-metric`; phone `--text-title-touch`.
- Weights: 400 body, 500 labels, names, buttons; 600 titles. No italics, no all caps.
- Tabular numbers for counts, times and durations.

## Components: which one
- Dialog: blocking decision or short form (CommissionForm, RenameDialog, ReleaseDialog, RetireDialog, StartingPromptDialog, compose). Width `--size-dialog-sm` for confirms, `--size-dialog-md` for forms.
- Sheet, side (desktop): inspect one item without leaving a list (MessageSheet), `--size-sheet`.
- Sheet, bottom (phone): every menu, filter set and confirmation.
- Phone forms: full-screen page, TopBar in modal mode, primary action pinned to the bottom.
- Inline: validation, section errors, done notes, anything true while the page stays open.
- Toast: confirms a finished action or offers one follow-up (View, Try again, Copy id). Never validation, never the only record. Must act, or state persists → inline instead.
- DropdownMenu: desktop only; phone opens the same items in a bottom Sheet. Items that open a dialog end with "…".
- Tooltip: extra detail only, never the sole place for information; none on phone.
- Select: short closed list. Combobox: search helps (ships, types). Tabs segmented: views of one list. Tabs line: page sections (Squadrons, Blueprints, Templates). Switch: instant setting. Checkbox: multi-select and FleetScopes only.
- Buttons: max one primary per view (page, Dialog, Sheet); others secondary; tertiary ghost. Destructive variant only for the final confirm of an irreversible action, never in a page toolbar.
- Button order: desktop footers right-aligned, Cancel left of the action; phone stacked full width, action on top, Cancel last.
- AccountMenu is the only home for the signed-in person: identity, this session, Account settings, Theme, Sign out. Future account features go here, never into page chrome. Desktop: Sidebar foot, DropdownMenu opening upwards. Phone: Avatar last in TopBar on every root page, bottom Sheet.
- Theme switch lives only in AccountMenu: Light, Dark, System (default System).
- argo: first in FleetTable; operator kind chip; row opens OperatorInbox; menu only Open inbox and Copy ship id; never Release, Rename, Retire, starting prompt, report or model; runs on "Console · Device"; excluded from SelectorPicker, CommandPalette ships and overview metrics; as a party "argo (you)".
- ReportLine on every other ship: FleetTable Report column, ShipHeader under the title. No report: "No report yet". Retired ships: none.
- FleetTable row: one 48 px line. Columns: name (ShipName plus operator chip, flagship chip or SquadronTag), Status, Report (ReportLine, time in title), Runs on (LocationTag with harness), Model (ModelTag), Seen (LastSeen), row menu. No Type, Inbox, Crewed since or last ping column: Type is a filter, open deliveries live on the ship page, the last ping answer on the ship page.
- FleetTable actions: all in the row menu. At most one next-step Button (secondary, xs; phone full width) in the Report cell, only: Awaiting crew → Get starting prompt, silent member → Get new crew line.
- Row menu: crewed: Message this ship…, Copy ship id, Ping, Re-crew…, Release ship…, Rename…, Retire ship…. Awaiting crew: Get starting prompt… in place of Ping, Re-crew, Release. Member: Ping, Get new crew line…, Release ship…, Remove from squadron…, no Rename or Retire. Flagship: Open squadron only. Retired: Copy ship id.
- ModelTag: the value exactly as the session stated it, stated time in title. Starts with @ or ends in @x.y.z → software (package mark, dashed outline); otherwise a model (sparkles mark). Empty for argo and ships without a session; "Not stated yet" for a crewed ship that has not stated one.
- LastSeen: icon only, "Last seen 25 s ago" as title and accessible name. Under 1 min fresh, 1 to 15 min a while, over 15 min long ago; same for squadron members. No icon without a session.
- FleetScopes: edit in CommissionForm, both off; read-only in the ShipHeader meta strip, "None" when empty.
- StartingPromptBlock always shows a CrewLineBlock per harness under the prompt: Claude Code, then Codex.

## Squadrons (only when enabled)
- Off: no Squadrons destination, Squadron filter, flagship chip, squadron states, health or silent members. Nothing else changes.
- On: Squadrons second in Sidebar and TabBar (TabBar gets 5 tabs); Squadron filter in the FleetTable toolbar and phone filter Sheet; CommandPalette adds squadrons, blueprints and squadron actions.
- Member name: the ship name as is; a squadron may prefix names but the console never parses them. Membership shows as SquadronTag, from the squadrons API.
- Flagship: like argo, never Release, Rename or Retire; its only action is Open squadron; retires when its squadron disbands. Message on a squadron goes to its flagship.
- Member: no Rename. Retire → Remove from squadron (RemoveMemberDialog). Get starting prompt → Get new crew line (CrewLineDialog). Silent: Get new crew line is the primary action.
- Crew lines carry the secret: CrewLineBlock shows them once, with the template's launch note; afterwards only "Crew line issued … not claimed yet".
- Forming: FormSquadronDialog (blueprint and version, then preview) → squadron page in Forming: StationProgress plus crew lines in MemberList rows. All on station: Sailing, Toast "<id> is sailing".
- Health only on members: HealthIndicator, dot plus word. Silent = 3 missed check-ins; only silent members go to Needs attention (and its count). Late and Blocked stay on the squadron page.
- Blueprints and templates are read-only (BlueprintTable, BlueprintView, TemplateTable, TemplateView): show source file and commit, never edit controls.
- UpgradeBlueprintDialog lists every change per member and per hand-off.
- Disbanded squadrons hide behind "Show disbanded (n)", like retired ships, and keep a read-only page.

## Crew requests and trierarchs
- "Requested by" on a crew request names the actor of the ship's latest `CrewRequested` event, from its timeline; no stored field holds it. argo reads "you".
- The Trierarchs sidebar count is silent machines only. Requests no trierarch can take already show on Needs crew; they are not counted twice.
- Commissioning: Request a crew is on by default while the trierarch plugin is connected, off otherwise.

## States
- Every data view builds four states: ready, empty, loading, error.
- Loading: keep chrome and headings; LoadingSkeleton in the content's shape; no page spinners; spinner only inside a busy Button; after 10 s show the error state.
- Empty (EmptyState): title says what is empty; one sentence says what fills it; one action only if it can be done here. Page empty uses a dashed frame. Filtered empty: `No ships match “query”.` + Clear search.
- Error (InlineError): page replaces content, keeps chrome, title `Couldn’t <verb> <thing>`, says whether anything was lost, technical reason in mono, Try again plus automatic retry. Section: where the action happened, says nothing changed. Field: under the field, names the broken rule.
- Busy dialog: action Button loading, other buttons disabled, dialog stays open; on failure show a section InlineError inside it and keep the input.
- Voice in states: calm, factual, no blame, no exclamation marks, no "Oops". What happened, what did not change, what to do.
- Live data: rows update in place, new rows get `--highlight`, never reorder under the pointer.

## Destructive actions
- No confirm: Ping, Mark done, Mark as unread, Resend, Dismiss, Get new prompt (the dialog states the old one stops working), Sign out.
- Normal confirm (Dialog, phone bottom Sheet): Get new crew line, always (it says what the new line ends: a session or an unclaimed line); Release; Retire or Remove from squadron with no open deliveries; Stand down; Force stand down with no open work; Upgrade blueprint (primary button); Rename (the dialog is the confirm).
- TypedConfirm only when an irreversible action discards pending work: Retire with open deliveries (type the ship name); Remove from squadron with open deliveries (type the ship name); Force stand down with open work (type the squadron id).
- Confirm title is the question ("Retire reviewer-01?"); body lists consequences as facts; the button names action and consequence ("Retire and abandon 3 deliveries"). Never "OK" or "Yes".
- No other protective rules.

## Copy
- Plain, direct, present tense, "you" for the operator. Short sentences.
- Sentence case everywhere: titles, buttons, menu items, tabs. Ship names, types and ids exactly as stored.
- Terms (UI copy only; code keeps the blueprint terms): ship, commission, crew, crewed, awaiting crew, release, retire, starting prompt, crew line, re-crew, ping, report, harness, model, last seen, fleet scope, delivery, pending, in flight, acknowledged, undeliverable, dismissed, abandoned, operator, argo. Squadrons: squadron, flagship, member, role, blueprint, template, charter, launch note, check-in, form, on station, sailing, stand down, disbanded, hand-off. Not: lease, revoke, rotate, user, agent (except "agent session"), team, deploy.
- ShipName: add ` · XXXX` (last 4 id characters) in ShipTimeline, DeliveryHistory, retired ships and message parties. Never for argo.
- Type address: Badge type chip in mono; prose "Any ship of type reviewer"; short "any reviewer".
- Ids: mono, shortened in the middle (`shp_01J8XK4T…YB4C`), full value in `title`; CopyButton copies the full id.
- Times: relative under 24 h ("6 min ago"); durations "1 d 2 h", "11 min"; otherwise "28 Sep, 14:21" (24 h clock); envelopes and meta strips "28 Sep 2026, 14:05:51"; seconds only in DeliveryHistory and envelopes; relative times carry the absolute in `title`.
- Numbers as digits: "1 open", "3 deliveries".
- Buttons: verb + object, max 4 words ("Commission ship", "Send reply"); "Try again" for retries; "Cancel" before anything is done, "Close" after.
- LocationTag text: `<Kind> · <description>`. With a harness (FleetTable): `<Harness> · <Kind>`, description in title; claude-code, codex, claude-chat, chatgpt, grok, grokbot and console show icon plus Claude Code, Codex, Claude chat, ChatGPT, Grok, Grokbot, Console; any other harness plain text as stored.
- Versions: blueprints "v4", templates "tester@4", commits short (`4f2a91c`).
- No em dashes; use a colon, comma or full stop. Curly quotes and apostrophes.

## Icons
- Lucide, stroke 2, `currentColor`; decorative icons `--muted-foreground` and `aria-hidden`.
- Sizes: `--size-icon` in buttons, menus, inputs; `--size-icon-sm` in badges, meta lines, LocationTag; `--size-icon-lg` in phone TopBar and Sheet items; `--size-icon-xl` in EmptyState and page error tiles; `--size-icon-tab` in TabBar.
- Icon-only Button: `aria-label` always; Tooltip on desktop.
- StatusBadge icons mean their state only; never reuse them elsewhere.

## Responsive
- Below `--breakpoint-sm`: phone. From `--breakpoint-sm`: desktop layout, Sidebar as rail (`--size-rail`). From `--breakpoint-lg`: full Sidebar (`--size-sidebar`).
- Phone swaps: MemberList → role groups of cards; Sidebar → TabBar; Sidebar account button → TopBar Avatar opening AccountMenu; Header → TopBar; Table → list rows (FleetTable: name, chip, status and menu; report or next step; runs on, model, seen); DropdownMenu → bottom Sheet; form Dialog → full-screen page; confirm Dialog → bottom Sheet; side Sheet → pushed page, delivery first; two-pane OperatorInbox → list + page with pinned reply, TabBar hidden; filters → bottom Sheet; Toast above TabBar.
- Never drop an action on phone; move it into the TopBar menu or a bottom Sheet.
- Pages use AuthLayout, ListLayout or DetailLayout; no other skeleton.

## Accessibility
- Contrast: text 4.5:1; text 24 px and up 3:1; focus indicator 3:1. Token pairs on the page pass; recheck any new pair.
- Focus always visible: `--focus-outline` on buttons, links, rows, tabs, menu items; `--focus-ring` on fields; `--invalid-ring` on invalid fields.
- Keyboard order = visual order: Sidebar, Header, page title, primary action, toolbar, content.
- Dialog and Sheet: focus the first field or the safest button, trap focus, Esc closes, focus returns to the trigger.
- Accessible names: visible `<label>` for fields, `aria-label` for icon-only buttons; errors via `aria-invalid` + `aria-describedby`.
- Announce: Toast `role="status"` (errors `role="alert"`); count changes polite.
- Real elements: `<button>`, `<a href>`, `<input>`; no clickable divs. In tables the ship name is the link.
- `prefers-reduced-motion`: no slides, pulses or row fades; fades max `--duration-fast`.
- StationProgress is a `progressbar`; its changes are announced politely.

## Not covered
- Use the closest existing part unchanged and note "follows <part name>" in the PR.
