# Aeolus design conventions

Rules for every Aeolus app, for cases the Design system page does not show. Names = parts and tokens on that page. Screens are reference; on conflict the Design system page wins. The console's own rules: [console-conventions.md](console-conventions.md).

## Stack
- shadcn/ui on Base UI, Lucide, Tailwind v4 with CSS variables; dark = `.dark` on `<html>`.
- Every value is a token. Arbitrary values only as token references, e.g. `w-(--size-sheet)`.
- Wrap shadcn atoms; never fork their behaviour. No new atom when shadcn has one.
- Every clickable control (buttons, links styled as buttons, menu and select items, tabs, checkbox, switch) shows `cursor: pointer`, set once in the base CSS layer; a disabled one shows the default cursor.

## Colour
- Brand accent = `--primary`: primary Button, active nav item, open-message counts, active TabBar item. Nothing else.
- `--accent` = neutral hover and selected surface (shadcn meaning), never brand.
- One meaning per tone, the same in every app; a reader who learned a colour once reads it the same everywhere. Each family is `--tone-{attention|waiting|blocked|active|ok|ended}-{bg|fg|border}`:

  | Tone | Colour | Means | Ship state |
  | --- | --- | --- | --- |
  | attention | Coral | Something is wrong: act now | Alert |
  | waiting | Amber | Waits on a person | Awaiting crew |
  | blocked | Violet | The crew says it cannot go on | Blocked |
  | active | Sea | Live and in motion | Working |
  | ok | Green | Settled and well | Crewed |
  | ended | Grey | Over for good | Retired |

  Idle carries no tone: `--muted-foreground`. The values are in `packages/ui/src/tokens.css` and only there: an app takes them from `@aeolus-fleet/ui` and keeps no colour of its own for a state. Story: Design/Tones.
- Status is never colour alone: icon + label always; the live dot always has its word.
- Alert tone: error → attention; warning or rate limit → waiting; neutral fact → ended; calm notice (signed in elsewhere) → `--muted` panel.
- `--destructive` fills only the final confirm Button. Destructive menu items and field errors use `--destructive-text`.

## Spacing and density
- `--spacing: 4px`; use only steps on the page: spacing-0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12.
- Icon to text: spacing-1.5 in badges and meta, spacing-2 in buttons. Between buttons: spacing-2.
- Desktop page: padding spacing-5 vertical, spacing-6 horizontal; section gap spacing-4; card padding spacing-3. Cards have a border and no shadow.
- Phone page: gutter spacing-4; section gap spacing-3.5; list row padding spacing-3 by spacing-3.5.
- Dialog padding spacing-6; field gap spacing-4.
- Table: header `--size-row-header`, row `--size-row`, cell padding x spacing-4, one row action (ghost icon Button, xs) in the last column.
- Controls: desktop `--size-control` (toolbar and header `--size-control-sm`, row actions `--size-control-xs`); phone always `--size-control-touch`.

## Typography
- Page title `--text-title` (desktop h1, phone root TopBar). One per page.
- Ship name on its page: `--text-title` desktop, `--text-title-touch` phone.
- Dialog, Sheet and EmptyState titles: `--text-heading` desktop, `--text-heading-touch` phone.
- Section title `--text-section`.
- Body `--text-body` desktop, `--text-body-touch` phone; phone inputs `--text-input-touch`. Long prose (a message's text body) `--text-prose` desktop.
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
- Select: short closed list; an overview filter's Select picks several values. Combobox: search helps (ships, types). Tabs segmented: views of one list. Tabs line: page sections (Squadrons, Blueprints, Templates). Switch: instant setting. Checkbox: multi-select in forms and FleetScopes only.
- Buttons: max one primary per view (page, Dialog, Sheet); others secondary; tertiary ghost. Destructive variant only for the final confirm of an irreversible action, never in a page toolbar.
- Button order: desktop footers right-aligned, Cancel left of the action; phone stacked full width, action on top, Cancel last.
- AccountMenu is the only home for the signed-in person: identity, this session, Account settings, Theme, Sign out. Future account features go here, never into page chrome. Desktop: Sidebar foot, DropdownMenu opening upwards. Phone: Avatar last in TopBar on every root page, bottom Sheet.
- Theme switch lives only in AccountMenu: Light, Dark, System (default System).

## States
- Every data view builds four states: ready, empty, loading, error.
- Loading: keep chrome and headings; LoadingSkeleton in the content's shape; no page spinners; spinner only inside a busy Button.
- Empty (EmptyState): title says what is empty; one sentence says what fills it; one action only if it can be done here. Page empty uses a dashed frame. Filtered empty: `No ships match “query”.` + Clear search.
- Error (InlineError): page replaces content, keeps chrome, title `Couldn’t <verb> <thing>`, says whether anything was lost, technical reason in mono, Try again. Section: where the action happened, says nothing changed. Field: under the field, names the broken rule.
- Busy dialog: action Button loading, other buttons disabled, dialog stays open; on failure show a section InlineError inside it and keep the input.
- Voice in states: calm, factual, no blame, no exclamation marks, no "Oops". What happened, what did not change, what to do.
- Live data: rows update in place, new rows get `--highlight`, never reorder under the pointer.


## Destructive actions
- Three levels: no confirm, a normal confirm (Dialog, phone bottom Sheet), and TypedConfirm only when an irreversible action discards pending work. Which action takes which: [console-conventions.md](console-conventions.md#destructive-actions).
- Confirm title is the question ("Retire reviewer-01?"); body lists consequences as facts; the button names action and consequence ("Retire and abandon 3 deliveries"). Never "OK" or "Yes".
- No other protective rules.

## Copy
- Plain, direct, present tense, "you" for the operator. Short sentences.
- Sentence case everywhere: titles, buttons, menu items, tabs. Ship names, types and ids exactly as stored.
- Ids: mono, shortened in the middle (`shp_01J8XK4T…YB4C`), full value in `title`; CopyButton copies the full id.
- Times: relative under 24 h ("6 min ago"); durations "1 d 2 h", "11 min"; otherwise "28 Sep, 14:21" (24 h clock); envelopes and meta strips "28 Sep 2026, 14:05:51"; seconds only in DeliveryHistory and envelopes; relative times carry the absolute in `title`.
- Numbers as digits: "1 open", "3 deliveries".
- Buttons: verb + object, max 4 words ("Commission ship", "Send reply"); "Try again" for retries; "Cancel" before anything is done, "Close" after.
- No em dashes; use a colon, comma or full stop. Curly quotes and apostrophes.

## Icons
- Lucide, stroke 2, `currentColor`; decorative icons `--muted-foreground` and `aria-hidden`.
- Sizes: `--size-icon` in buttons, menus, inputs; `--size-icon-sm` in badges, meta lines, LocationTag; `--size-icon-lg` in phone TopBar and Sheet items; `--size-icon-xl` in EmptyState and page error tiles; `--size-icon-tab` in TabBar.
- Icon-only Button: `aria-label` always; Tooltip on desktop.
- StatusBadge icons mean their state only; never reuse them elsewhere.

## Responsive
- Below `--breakpoint-sm`: phone. From `--breakpoint-sm`: desktop layout, Sidebar as rail (`--size-rail`). From `--breakpoint-lg`: full Sidebar (`--size-sidebar`).
- Never drop an action on phone; move it into the TopBar menu or a bottom Sheet.

## Accessibility
- Contrast: text 4.5:1; text 24 px and up 3:1; focus indicator 3:1. Token pairs on the page pass; recheck any new pair.
- Focus always visible: a 2 px `--ring` outline, offset 2 px, on everything focusable (`:focus-visible` in `globals.css`); fields add a `--ring` ring at 22 %; an invalid field (`aria-invalid`) a `--destructive` border and ring at 16 % (`components/atoms/input.tsx`).
- Keyboard order = visual order: Sidebar, Header, page title, primary action, toolbar, content.
- Dialog and Sheet: focus the first field or the safest button, trap focus, Esc closes, focus returns to the trigger.
- Accessible names: visible `<label>` for fields, `aria-label` for icon-only buttons; errors via `aria-invalid` + `aria-describedby`.
- Announce: Toast `role="status"` (errors `role="alert"`); count changes polite.
- Real elements: `<button>`, `<a href>`, `<input>`; no clickable divs. In tables the ship name is the link.
- `prefers-reduced-motion`: no slides, pulses or row fades; fades max `--duration-fast`.

## Not covered
- Use the closest existing part unchanged and note "follows <part name>" in the PR.
