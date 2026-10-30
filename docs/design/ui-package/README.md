# One set of UI parts for every Aeolus app

Stage 1 of [issue 1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206): purpose, what exists, lessons, questions. Proposed, not decided. Nothing below is built until Thomas agrees the purpose and answers the questions; then the structure, then one part at a time.

Thomas, 24 Oct: "In the end we are making the same components. So doing it once is better." 30 Oct: "Ok I also want to start the work on the UI elements package for aeolus the product."

## 1. Purpose (proposed)

- **One part, built once.** A part two Aeolus apps both show (a button, a status badge, a scope picker) is built, themed and tested once, and every app takes it from the same place at a stated version.
- **One look.** The parts carry the design system (`docs/design/`), so an app that uses them looks and behaves like the console without copying its rules.
- **Fix once.** A defect in a shared part, such as scope pickers showing raw codes ([#1205](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1205)), is fixed in one place for every app.

The apps that use it:

| App | Repository | Uses it for |
| --- | --- | --- |
| Console | aeolus-fleet (`packages/console`) | Every page; today the source of most parts |
| Gateway | aeolus-fleet-gateway (`web/`) | Its Next.js pages (header design H3) |
| Account and Admin | pagasae | Every page |
| Plugin pages | aeolus-fleet-squadrons, aeolus-fleet-trierarch-plugin, aeolus-fleet-networking-plugin | The pages each plugin serves itself (decision 0043), once it has any |

Not the purpose:
- **Not a shell or micro frontends.** Each app stays its own Next.js app with its own routes (0043, header H3).
- **Not data.** Parts take props only: no fetching, no tRPC, no store, no zod in the browser (0033). Each app reads its data behind its own hooks and hands the part what to show.
- **Not product behaviour.** A part shows what the blueprint and each app's server decide; it never decides who may do what.
- **Not every part.** A part an app alone shows (FleetTable, ShipTimeline, the gateway's tools table) stays in that app.
- **Not a public component library.** Built for the Aeolus apps only (0013: no paid-product polish for zero customers).

## 2. What exists today

Snapshots: aeolus-fleet `d2c99ec4`, gateway `f6481db` (29 Oct), pagasae `dd30a0c` (30 Oct), the three plugins on `main` (19 to 28 Oct).

### Shared already: `@aeolus-fleet/common/header`

Built by the header design (H2), in core's train:
- **Atoms (7):** Avatar, Button, Dialog (with `dialog-surface.ts`), DropdownMenu, Kbd, Sheet, Tooltip, in `packages/common/src/header/atoms/`.
- **Header parts (5):** AppHeader, AppSwitcher, AvatarMenu, CommandPalette, SignInBackground, in `packages/common/src/header/`.
- **Tokens:** `packages/common/src/header/tokens.css`, 154 lines, the single copy by design.
- **Rules around it:** React, Base UI and lucide as optional peers of common; lint blocks `aeolus/common-header` (client-safe) and `aeolus/common-without-react`; each app scans the subpath with Tailwind `@source`.
- **Stories:** run in the console's Storybook (`packages/console/.storybook/main.ts:18` globs `../../common/src/header/**`).
- **Test ids:** fixed and named for the part, such as `avatar-menu-session` and `header-search` (34 in the header's files).

### The design system

- `docs/design/README.md`: tokens, then 21 atoms, 19 molecules, 33 organisms and 3 templates, each with a PNG and canvas source. Exported from the canvas "Aeolus operator console v1".
- `docs/design/conventions.md` ("Aeolus console conventions", 148 lines) mixes rules for every app (colour, spacing, typography, which component when, states, copy, accessibility) with console-only rules (FleetTable, argo, squadrons, crew requests, network).

### What each app builds itself

**Console** (`packages/console`): 18 atoms in `components/atoms/` (Input, Select, Combobox, Switch, Tabs, Table, Toast on Sonner, Skeleton, AlertDialog, CopyButton, CodeBlock and more), 35 molecules, 13 organisms; 20 features. It takes the header atoms from common (177 files import `@aeolus-fleet/common/header`).

**Gateway** (`web/`, Next.js 16, Base UI, Tailwind 4, no shadcn config):
- Takes the header, Button and Avatar from common (`^0.32.0`), in 4 files.
- Keeps `web/app/tokens.css`, byte-identical to common's; `web/app/globals.css:3` says it is a copy until common holds the single one, which it now does.
- No atoms folder; Base UI used directly for combobox, dialog, drawer and toast (`web/features/outside-party/tools-table/ui/`). Its own form kit in `web/features/forms/ui/` (6 files).

**pagasae** (Next.js 16, Base UI, Tailwind 4, Sonner):
- Takes the header from common (`0.34.0`), in `features/app-shell/organisms/account-header.tsx`.
- Keeps 17 atoms of its own in `components/atoms/`, 7 of them the same parts common ships (avatar, button, dialog, dialog-surface, dropdown-menu, sheet, tooltip), and `app/tokens.css`, byte-identical to common's. Dropping them is [pagasae #120](https://github.com/ThomasHendrickx/pagasae/issues/120), open.
- 15 molecules in `components/molecules/`.

**Plugins:** no pages yet. No `.tsx` or `.css` on `main` in any of the three; squadrons' `src/app.ts:90` waits "once its pages arrive". Their screens today are console features (`features/squadrons`, `features/trierarchs`: 36 `ui/` files).

### Parts that repeat

| Part | Console | Gateway | pagasae |
| --- | --- | --- | --- |
| Input, Label, Switch, Checkbox, Tabs, Skeleton, Separator, AlertDialog | `components/atoms/` | Base UI direct, `features/forms/ui/switch.tsx` | `components/atoms/` |
| Toast | Sonner, `components/atoms/toast.tsx` | Base UI Toast, `tools-table/ui/agent-needs.tsx` | Sonner, `components/atoms/toast.tsx` |
| StatusBadge (tone, icon, label) | `components/molecules/status-badge.tsx` | two, both named StatusBadge: `features/outside-parties/ui/status-badge.tsx`, `features/overview/ui/status-badge.tsx` | `components/molecules/limits.tsx` (ToneBadge) |
| Scope picker | CommissionForm scope groups with descriptions, `features/fleet/ui/organisms/commission-dialog.tsx:24`; `features/scopes/` | `tools-table/ui/scope-picker.tsx`, `features/outside-parties/scope-words.ts`; the A2A form shows bare codes (#1205) | rights per scope, `features/organisation/molecules/right-row.tsx` |
| EmptyState, InlineError, LoadingSkeleton, TypedConfirm | `components/molecules/` | none, inline per page | `components/molecules/`, same names |
| Relative time | per part | ad hoc, `features/outside-party/own-sign-in.ts:58` | `lib/format.ts` |

So: 3 copies of the tokens (one shared, two byte-identical copies), 2 sets of the same 7 atoms, 3 scope pickers each with its own wording, 4 StatusBadges, and 3 toasts on 2 libraries.

## 3. Lessons to check against

- **Thomas, header H2:** "why cant that be part of common? I dont see the point of yet another package." The shared header became a subpath of common, not a package.
- **Thomas, header H3:** every Aeolus web app is the same stack: Next.js, the web-frontend skill, the design tokens. A plugin's pages join that stack.
- **Header H2, client-safe:** the shared parts import no zod, no Node built-ins, no server code; from the rest of common, types only. Lint proves it.
- **Header step 5 and pagasae #120:** a copy left behind after the shared part ships stays. The header released, and pagasae and the gateway still hold copies of the tokens and atoms. A move is done when the copies are gone.
- **web-frontend skill:** shared parts are props only; "A part moves to shared when a second feature needs it"; shadcn/ui first, a custom atom needs a reason; every interactive part has stories for idle, pending, success and failure and a test that it shows pending at once; `data-testid="{area}-{element}"` on what tests touch.
- **E2E catalog ([#1412](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1412)):** text selectors are the largest anti-pattern (187 `getByText` lines in aeolus-fleet, 157 in pagasae), tied to flaky #1349. The gateway (130 `data-testid`) has no browser e2e. Thomas sets the rules after reading the catalog; a shared part must not fix a test id scheme ahead of them.
- **#1205:** the same picker built three times gave three wordings, one of them bare codes. The meaning of a scope comes from the scope catalogue (0046) and plugins' declared descriptions, read on the server.
- **Decisions:** 0008 (package count), 0013 (minimal, no compatibility layers), 0033 (logic on the server), 0043 (plugins serve their own pages, no micro frontends), 0049 (each train takes common from npm at a stated version, so the gateway on `^0.32.0` and pagasae on `0.34.0` move at their own pace), 0050 (one meaning per term).
- **One source of truth:** one copy of each part, of the tokens and of each rule; the design docs point to the parts, never copy them.

## 4. Questions for Thomas

### Q1. Where the parts live

Context: the header and its atoms already sit in `@aeolus-fleet/common/header`, with optional peers, lint and stories in place. A Button there is named a header part, though every page uses it.

Options:
1. **Widen common's subpath and rename it `@aeolus-fleet/common/ui`**: the header becomes one group inside it. Breaking for the gateway and pagasae imports, allowed before 1.0.0 (0013).
2. **Keep `@aeolus-fleet/common/header` and add to it.** No rename; the name stops matching what it holds.
3. **A new package, `@aeolus-fleet/ui`, in core's train.**
4. **Its own repository and train.**

Pick: 1. It follows H2 ("why cant that be part of common?") and keeps the boundary rules already built, and the name says what it holds. 3 and 4 add a package and a train for no gain.

### Q2. What goes in

Context: the repeats are atoms (Input, Switch, Tabs, Toast) and a handful of Aeolus molecules (StatusBadge, EmptyState, InlineError, TypedConfirm, LoadingSkeleton, the scope picker). Organisms are mostly one app's (FleetTable, the gateway's tools table).

Options:
1. **Atoms only.**
2. **Atoms, and a molecule or organism once a second app shows it.** The web-frontend rule ("moves to shared when a second feature needs it"), lifted from features to apps.
3. **Every part in `docs/design/README.md`,** moved up front.

Pick: 2. 1 leaves the scope picker and StatusBadge, the parts that drifted, as copies. 3 moves console-only parts no other app shows.

### Q3. The scope picker and where a scope's meaning comes from (#1205)

Context: the motivating repeat. The console shows descriptions from the fleet; the gateway has its own wording file (`scope-words.ts`); pagasae its own rows.

Options:
1. **The part takes each scope with its description as props;** each app's server reads the catalogue from core (and plugins' declared descriptions) and hands it over.
2. **The part holds the catalogue's wording itself.** Plugin scopes, declared at runtime, could not be shown this way.

Pick: 1. Logic and outside data stay on the server (0033), and plugin scopes work the same as fleet scopes.

### Q4. The design docs for every app

Context: `docs/design/README.md` and `conventions.md` are named for the console and mix product-wide rules with console-only ones. The gateway and pagasae follow them by habit, not by pointer.

Options:
1. **Split conventions.md:** the rules for every app (tokens, which component when, states, copy, accessibility) in one file the shared parts point to; console-only rules (FleetTable, argo, squadrons) in a console file. The parts table marks which parts are shared.
2. **Leave both as they are;** other apps read the console's rules.

Pick: 1. Each fact gets one home with a name that fits it; the console-only lines stop reading as rules for the gateway.

### Q5. Test ids on shared parts

Context: the header parts carry fixed ids named for the part (`avatar-menu-session`). A part shown twice on a page (two scope pickers) would repeat an id. #1412's rules are still to come.

Options:
1. **Fixed ids named for the part,** as the header does, and the app scopes them with a container id where one part shows twice.
2. **Each part takes a `testId` prefix prop.**
3. **No ids in shared parts; tests find them by role and accessible name.**

Pick: 1 for now, as the header does, and revisit once Thomas sets #1412's rules. It adds no prop to every part; is this the right holding point, or should this wait for #1412?

### Q6. The order of work

Context: the copies of what is already shared still stand (pagasae #120, the gateway's `web/app/tokens.css`).

Options:
1. **Finish what is shared first:** the gateway and pagasae drop their copies of the tokens and the seven atoms. Then the rename (Q1). Then the atoms that repeat, one at a time. Then StatusBadge and the scope picker (#1205).
2. **Scope picker first,** as the visible defect, then the rest.

Pick: 1. Every later part lands on one copy of the tokens and atoms; done means the copies are gone (lesson from H2). #1205's wording fix can ship in the gateway meanwhile if Thomas wants it sooner.

### Q7. Plugin pages

Context: no plugin serves a page yet; squadrons and the trierarch plugin show theirs as console features. H12 says plugin pages are not apps yet.

Options:
1. **In the purpose, no work now:** a plugin's first page uses the shared parts, on the same stack (H3).
2. **Out of the purpose until a plugin has pages.**

Pick: 1. Naming them now keeps the parts free of console-only assumptions, at no cost.
