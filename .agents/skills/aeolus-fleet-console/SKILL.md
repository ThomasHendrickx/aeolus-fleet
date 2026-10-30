---
name: aeolus-fleet-console
description: Mandatory with web-frontend for changes under packages/console. Where the console's look and rules come from.
---

# Console in aeolus-fleet

Load with `web-frontend`.

- The console is `argo`. Plugin calls and parsing their answers run on the web app's server or behind tRPC (decision 0033). The browser imports from `common` only types and `@aeolus-fleet/common/rules`; never zod.
- Folders: as CLAUDE.md (Web) states; shared non-UI code sits in the console's root `lib/`. The old-layout features are the ones in `featuresInTheOldLayout` (`eslint.config.js`); the change that moves one drops it from the list.
- Look from `docs/design/` (read `conventions.md` first, then only the parts you build), behaviour from the blueprint. Theme from `packages/common/src/header/tokens.css`, the single copy of the tokens; the header and its atoms (Button, DropdownMenu, Sheet, Dialog, Avatar, Kbd, Tooltip) come from `@aeolus-fleet/common/header`.
- API client: tRPC; hooks such as `useFleetSnapshot`, in `lib/` when several features use them. shadcn/ui on Base UI. A route's client part sits beside its server `page.tsx`, such as `(console)/inbox/inbox-page.tsx`; signed-in pages sit in the `(console)` route group, whose layout holds the ConsoleFrame and hands each page `useConsoleFrame()`.

Enforced by lint (`eslint.config.js`): layer imports, shared code never importing a feature or `app/`, no feature importing another, a new feature's folders, no tRPC or hooks in shared components or a feature's `ui/` (old layout: its atoms and molecules), browser storage, manual memoisation, index keys, jsx-a11y.
