# One set of UI parts for every Aeolus app

[Issue 1206](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1206). Stage 1 (purpose, what exists, lessons, questions) is answered (section 4). Stage 2, below, is the structure only: proposed, not decided. Nothing is built until Thomas approves it; then one part at a time (section 7).

Screens, which app's part the package takes, and the chosen look (Compact): [mockups/README.md](mockups/README.md).

Thomas, 24 Oct: "In the end we are making the same components. So doing it once is better." 30 Oct: "Ok I also want to start the work on the UI elements package for aeolus the product."

## 1. Purpose (agreed)

- **One part, built once.** A part two Aeolus apps both show (a button, a status badge, a scope picker) is built, themed and tested once, and every app takes it from `@aeolus-fleet/ui` at a stated version.
- **The console's setup.** Thomas: "To add atomic design, same front end skills and setup for UI as console." Atoms, molecules and organisms; shadcn/ui on Base UI; the web-frontend skill; a story per state and the same test layers as the console.
- **Pure UI, minimal behaviour.** Thomas: "And this package is pure UI only, minimal behaviour. Only when needed for pure UI interactions and animations." Parts take props only: no fetching, no tRPC, no store, no zod (0033). Each app reads its data behind its own hooks and hands the part what to show.
- **One look.** The parts carry the design system (`docs/design/`), so an app that uses them looks and behaves like the console without copying its rules.
- **Fix once.** A defect in a shared part, such as scope pickers showing raw codes ([#1205](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1205)), is fixed in one place for every app.

The apps that use it:

| App | Repository | Uses it for |
| --- | --- | --- |
| Console | aeolus-fleet (`packages/console`) | Every page; today the source of most parts |
| Gateway | aeolus-fleet-gateway (`web/`) | Its Next.js pages (header design H3) |
| Account and Admin | pagasae | Every page |
| Plugin pages | aeolus-fleet-squadrons, aeolus-fleet-trierarch-plugin, aeolus-fleet-networking-plugin | The pages each plugin serves itself (decision 0043), once it has any; no work now (UP7) |

Not the purpose:
- **Not a shell or micro frontends.** Each app stays its own Next.js app with its own routes (0043, header H3).
- **Not product behaviour.** A part shows what the blueprint and each app's server decide; it never decides who may do what.
- **Not every part.** A part one app alone shows (FleetTable, ShipTimeline, the gateway's tools table) stays in that app (UP2).
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

- **Thomas, UP1:** "Header was part of common since we did not have the package." The header and its atoms move from `@aeolus-fleet/common/header` into `@aeolus-fleet/ui`; header H2's "why cant that be part of common?" held while no UI package existed.
- **Thomas, UP4:** "Dependency purely is the web apps pointing to the UI package. UI package has nog clue on any web app or other package (except maybe common of needed)".
- **Thomas, header H3:** every Aeolus web app is the same stack: Next.js, the web-frontend skill, the design tokens. A plugin's pages join that stack.
- **Header H2, client-safe:** the shared parts import no zod, no Node built-ins, no server code; from common, types only. Lint proves it.
- **Header step 5 and pagasae #120:** a copy left behind after the shared part ships stays. The header released, and pagasae and the gateway still hold copies of the tokens and atoms. A move is done when the copies are gone.
- **web-frontend skill:** shared parts are props only; "A part moves to shared when a second feature needs it"; shadcn/ui first, a custom atom needs a reason; every interactive part has stories for idle, pending, success and failure and a test that it shows pending at once; `data-testid="{area}-{element}"` on what tests touch.
- **E2E catalog ([#1412](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1412)):** text selectors are the largest anti-pattern (187 `getByText` lines in aeolus-fleet, 157 in pagasae), tied to flaky #1349. Thomas sets the rules after reading the catalog; the test ids below hold until then (UP5).
- **#1205:** the same picker built three times gave three wordings, one of them bare codes. The meaning of a scope comes from the scope catalogue (0046) and plugins' declared descriptions, read on the server.
- **Decisions:** 0008 and 0049 (packages and trains: ui joins core's train), 0013 (minimal, no compatibility layers), 0033 (logic on the server), 0043 (plugins serve their own pages, no micro frontends), 0050 (one meaning per term).
- **One source of truth:** one copy of each part, of the tokens and of each rule; the design docs point to the parts, never copy them.

## 4. Thomas's answers (stage 1)

| # | Answer |
| --- | --- |
| UP0 | Purpose changed: "To add atomic design, same front end skills and setup for UI as console. And this package is pure UI only, minimal behaviour. Only when needed for pure UI interactions and animations." (section 1) |
| UP1 | 3: a new package, `@aeolus-fleet/ui`, in core's train. "Header was part of common since we did not have the package." The header and its atoms move from common into ui. |
| UP2 | 2: atoms, plus a molecule or organism once a second app shows it. |
| UP3 | 1: the scope picker takes each scope with its description as props; each app's server reads them. |
| UP4 | 1: split the design rules into every-app and console-only. "Dependency purely is the web apps pointing to the UI package. UI package has nog clue on any web app or other package (except maybe common of needed)" |
| UP5 | 1: fixed test ids named for the part, scoped by a container id where one part shows twice; revisit with #1412. |
| UP6 | 1: the copies go first, then the move, then the repeating atoms one at a time, then StatusBadge and the scope picker. |
| UP7 | 1: plugin pages in the purpose, no work now. |

## 5. Structure (stage 2, proposed)

### 5.1 The package

`packages/ui`, published as `@aeolus-fleet/ui`, Apache-2.0, a workspace of aeolus-fleet beside common, core and console, released with them at one version (0049, ADR 0011).

### 5.2 Layout

Atomic design, as the console's `components/`:

```
packages/ui/
  package.json
  README.md            what the package is; points to docs/design/conventions.md
  tsconfig.json
  tsconfig.build.json  excludes tests and stories
  .storybook/          main.ts, preview.tsx (5.5)
  src/
    index.ts           the one entry (5.3)
    tokens.css         the single copy of the design tokens
    class-names.ts     the class merge helper every part uses
    atoms/             Avatar, Button, Dialog (with dialog-surface.ts), DropdownMenu, Kbd, Sheet, Tooltip; later the repeats
    molecules/         AppSwitcher, AvatarMenu (with avatar-entry.ts); later EmptyState, InlineError, LoadingSkeleton, TypedConfirm, StatusBadge
    organisms/         AppHeader, CommandPalette, SignInBackground (with sign-in-backgrounds.ts); later the scope picker
```

- One part per file, kebab-case, its stories (`*.stories.tsx`) and tests (`*.test.ts`) beside it, as today.
- A part's pure UI helper (the avatar entry's working label, a background's drawing) sits beside the part that uses it. Logic that is not UI stays out (Q8).
- `'use client'` on each interactive part's file, as in the header today.
- A layer imports only below itself: an atom no molecule or organism, a molecule no organism.
- No `templates/`: route layouts are each app's own.

### 5.3 Exports

```json
"exports": {
  ".": { "@aeolus-fleet/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./tokens.css": "./dist/tokens.css"
}
```

- One entry, `@aeolus-fleet/ui`, re-exporting every part; `sideEffects: false`, so an app's bundle takes only what it imports.
- `./tokens.css` for each app's `globals.css`.
- The `@aeolus-fleet/source` condition as common has it, so the workspace resolves to source; `set-version` drops it for the tarball (#968).
- Build: `tsc --project tsconfig.build.json`, then copy `tokens.css` into `dist`, as common's header does now.
- Peers, not optional: `react`, `react-dom`, `@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, and `@aeolus-fleet/common` for types (Q9). Toast's library joins with Toast (Q12).

### 5.4 The dependency rule and how lint enforces it

The rule (UP4): apps depend on ui; ui depends on no app and no package but common, for types only.

| What | Enforced by |
| --- | --- |
| ui's `package.json` names no `@aeolus-fleet` package but common | `scripts/check-train-dependencies.ts`: ui joins `OWN_TRAIN`, and a second check refuses any other `@aeolus-fleet` name in ui's manifest |
| ui's source imports no `@aeolus-fleet/core`, `@aeolus-fleet/console` or any other `@aeolus-fleet` name, and common only by `import type` | ESLint `aeolus/ui` (`no-restricted-imports` and the type-only syntax rule header H2 built) |
| ui imports no zod, `node:`, `@trpc/`, `@tanstack/`, `next/` (Q10), and reads no fetch or browser storage | `aeolus/ui`, with the console's `webImpure` globals and properties |
| A layer imports only below itself | `aeolus/ui-<layer>`, the console's `upwardImports` |
| React rules as the console (hooks, a11y, no index keys, no manual memo) | `aeolus/ui` extends what `aeolus/web` extends |
| An app takes ui by its entry only, never `@aeolus-fleet/ui/src/...` or a relative path into `packages/ui` | `aeolus/web` in the console; the gateway and pagasae add the same pattern in their own config |
| common holds no React any more | `aeolus/common-without-react` widens to all of `packages/common/src`; common drops its React peers and its `dom` and `jsx` compiler options |

Each rule gets its lint test in `lint/ui.test.ts`, as `lint/common-header.test.ts` proves the header's today (that file goes with the move).

### 5.5 Stories and tests

Like the console:
- **Storybook in the package:** `packages/ui/.storybook/main.ts` globs `../src/**/*.stories.tsx`; `preview.tsx` sets light or dark on `<html>`, the Geist fonts and the `TooltipProvider`, as the console's preview does. The console's Storybook stops globbing common and shows only its own parts.
- **A story per meaningful state;** an interactive part has idle, pending, success and failure, and a play function that a press shows pending at once (web-frontend).
- **Vitest projects** in the root `vitest.config.ts`: `ui:unit` (`src/**/*.test.ts`, such as the backgrounds and avatar entry tests) and `ui:stories` (every story in Chromium through `@storybook/addon-vitest`, as `console:stories`). `common:unit` loses the header's tests.
- **Test ids (UP5):** fixed, named for the part (`avatar-menu-session`, `header-search`); where one part shows twice, the app wraps each in a container with its own id and tests scope to it. Revisited when #1412's rules land.

### 5.6 How apps consume it

- **Console:** a workspace dependency, `"@aeolus-fleet/ui": "0.0.0"`, pinned to the train's version by `set-version` like common. Its `globals.css` imports `../../ui/src/tokens.css` and scans `../../ui/src` with `@source`, as it does common's header now.
- **Gateway, pagasae, a plugin's pages:** `@aeolus-fleet/ui` from npm at a stated version in their own `package.json`, moved at their own pace, as common today (0049). Their `globals.css` imports `@aeolus-fleet/ui/tokens.css` and scans `node_modules/@aeolus-fleet/ui/dist` with `@source`.
- **Same version for ui and common:** ui's peer on common is pinned to the same train version, so an app that takes ui `0.40.0` takes common `0.40.0`.
- **Release:** `set-version`'s `PUBLISHED_PACKAGES`, `release.yml` and the candidate workflow gain ui, published before core and console.

### 5.7 Docs and skills

- **Decisions:** 0008 and 0049 name ui in core's train.
- **docs/architecture.md:** the package list, with what ui holds and the dependency rule; common back to schemas and ids.
- **CLAUDE.md:** the package line gains ui; the skills line gains `packages/ui` (Q11).
- **docs/design (UP4):** `conventions.md` keeps the rules for every app (colour, spacing, typography, which component when, states, copy, accessibility); the console-only rules (FleetTable, argo, squadrons, crew requests, network) move to `docs/design/console-conventions.md`. The parts table in `docs/design/README.md` marks each part that lives in ui.
- **docs/design/header/README.md:** points to ui where it names common's subpath.

## 6. Decisions to record on approval

- **0008 Separate packages**, changed: `@aeolus-fleet/ui` in core's train; apps depend on it, it depends on no app and on common for types only.
- **0049 Release trains**, changed: core's train is common, ui, core and console.

## 7. Slices, once approved

In UP6's order. Each atom and molecule slice is done only when the gateway's and pagasae's copies are gone (lesson from header step 5), so each has a PR in those repositories after the release that carries it.

| # | Repo | Slice | Done when |
| --- | --- | --- | --- |
| U1 | pagasae | Drop the seven atom copies and `app/tokens.css`; take them from `@aeolus-fleet/common/header` (pagasae #120) | The files are gone; its tests green by name; walked on staging |
| U2 | aeolus-fleet-gateway | Drop `web/app/tokens.css`; import common's | The file is gone; the pages look the same on staging |
| U3 | aeolus-fleet | The package: `packages/ui` (5.1 to 5.3); the header, its atoms, `tokens.css` and `class-names.ts` move from common by layer (5.2); `ui:unit` and `ui:stories` (5.5); the lint rules and their tests (5.4); the train (5.6); common drops `./header` and its React peers; the console imports ui; 0008, 0049, architecture.md, CLAUDE.md and the skill (5.7) | typecheck, lint and test green, `ui:unit`, `ui:stories` and each `lint/ui.test.ts` rule seen by name; a candidate publishes `@aeolus-fleet/ui`; nothing under `packages/common` imports React |
| U4 | aeolus-fleet-gateway, pagasae | Take `@aeolus-fleet/ui` at the release that carries U3; no import of `@aeolus-fleet/common/header` | Neither repository imports `common/header`; both walked on staging |
| U5 | aeolus-fleet | Split `conventions.md` (5.7) | The every-app file holds no console-only rule; ui's README and `docs/design/README.md` point to it |
| U6 to U14 | aeolus-fleet, then gateway and pagasae | The repeating atoms, one slice each: Input, Label, Switch, Checkbox, Tabs, Skeleton, Separator, AlertDialog, Toast (Q12). The console's atom moves to ui with its stories; the console imports it; the other two drop theirs | The atom in ui with a story per state; no copy in any of the three |
| U15 to U18 | aeolus-fleet, then pagasae | EmptyState, InlineError, LoadingSkeleton, TypedConfirm (console and pagasae show them), one each, as above | The molecule in ui; no copy in the console or pagasae; the gateway uses it where it builds one inline |
| U19 | aeolus-fleet, then gateway and pagasae | StatusBadge (tone, icon, label), from the console's | The gateway's two StatusBadges and pagasae's ToneBadge are gone |
| U20 | aeolus-fleet, then gateway and pagasae | The scope picker, from the gateway's, each scope with its description as props (UP3); each app's server reads the descriptions | The gateway's `scope-words.ts` is gone; the A2A form shows descriptions; #1205 closed; walked on staging |

Not moving now: relative time (a formatter, not a part; each app keeps its own until a part shows it), the console's other atoms (Select, Combobox, Table, CopyButton, CodeBlock and more) until a second app shows them (UP2).

## 8. Questions (stage 2)

### Q8. The app switcher's list of apps

Context: `apps.ts` works out which fleets and apps the switcher offers from pagasae's apps list and builds each `?fleet=` link. That is product knowledge (which apps exist, where each opens), not a UI interaction (UP0).

Options:
1. **The switcher takes ready entries** (label, link, current) as props; `apps.ts` stays in common as a React-free helper each app calls on its server, with its tests.
2. **`apps.ts` moves into ui** beside the switcher, as it sits beside it today.

Pick: 1. ui stays pure UI and knows no app (UP4); the helper is plain TypeScript on types common already holds.

### Q9. Common as ui's peer, for types

Context: AvatarMenu takes common's `Theme`; with Q8's 1, no other common type is needed. Thomas allowed common "if needed".

Options:
1. **Peer dependency on common, type-only imports,** lint-enforced (5.4).
2. **No dependency:** ui declares its own prop types, and `Theme` exists twice.

Pick: 1. One source for `Theme`; type-only imports put no common code in a browser chunk.

### Q10. Storybook framework

Context: the console's Storybook runs `@storybook/nextjs-vite`. No shared part imports Next.js today.

Options:
1. **`@storybook/react-vite`,** and lint bans `next/` in ui: a part that needs a link takes it through Base UI's `render` prop from the app.
2. **`@storybook/nextjs-vite`, like the console,** with `next/` allowed in parts.

Pick: 1. The rest of the setup matches the console (5.5); a part that knows no framework cannot reach into an app's routing.

### Q11. The skill for packages/ui

Context: CLAUDE.md names `web-frontend` and `aeolus-fleet-console` for `packages/console`. ui needs the same front end skills (UP0).

Options:
1. **A new `aeolus-fleet-ui` skill** with `web-frontend` for `packages/ui`: the layout, the dependency rule, the stories, and where the look comes from (`docs/design/conventions.md`).
2. **Widen `aeolus-fleet-console`** to cover `packages/ui` too.

Pick: 1. The console's skill names console-only rules; one skill per package keeps each short and true for what it covers.

### Q12. Toast's library

Context: the console and pagasae toast with Sonner (shadcn's toast); the gateway with Base UI's Toast.

Options:
1. **Sonner,** the console's atom; the gateway moves to it.
2. **Base UI's Toast,** with no extra library; the console and pagasae move to it.

Pick: 1. Two of the three apps and shadcn's own atom use it (shadcn/ui first).

### Q13. The move as one slice or two

Options:
1. **One slice (U3):** the package, the move, lint, the train and the docs in one PR.
2. **Two:** an empty package with its lint and train first, then the move.

Pick: 1. An empty package proves no rule; most of U3 is files moving unchanged.
