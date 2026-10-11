---
name: aeolus-fleet-console
description: Mandatory with web-frontend for changes under packages/console. Where the console's look and rules come from.
---

# Console in aeolus-fleet

Load with `web-frontend`.

- The console is `argo`. Server-side logic by default, always (decision 0033): plugin calls, parsing answers and checks on the web app's server or behind tRPC. The browser imports from `common` only types and `@aeolus-fleet/common/rules`; never zod.
- Look from `docs/design/` (read `conventions.md` first, then only the parts you build), behaviour from the blueprint. Theme from `packages/console/app/tokens.css`, the single copy of the tokens.
- API client: tRPC; hooks such as `useFleetSnapshot`, in `lib/` when several features use them. shadcn/ui on Base UI. Client route parts such as `(console)/inbox/inbox-page.tsx`; signed-in pages sit in the `(console)` route group, whose layout holds the ConsoleFrame and hands each page `useConsoleFrame()`.
- The operator's session is an httpOnly cookie. Destructive actions confirm as the blueprint says.

Enforced by lint (`eslint.config.js`): layer imports, shared code never importing a feature or `app/`, no feature importing another, no tRPC in shared components or in a feature's atoms and molecules, browser storage, manual memoisation, index keys, jsx-a11y.
