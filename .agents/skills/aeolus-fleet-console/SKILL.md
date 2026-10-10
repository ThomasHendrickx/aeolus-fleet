---
name: aeolus-fleet-console
description: Mandatory with web-frontend for changes under packages/console. Where the console's look and rules come from.
---

# Console in aeolus-fleet

Load with `web-frontend`.

- The console is `argo`. Server-side logic by default, always (decision 0033): plugin calls, parsing answers and checks on the web app's server or behind tRPC. The browser imports from `common` only types and `@aeolus-fleet/common/rules`; never zod.
- Look from `docs/design/` (read `conventions.md` first, then only the parts you build), behaviour from the blueprint. Theme from `packages/console/app/tokens.css`, the single copy of the tokens.
- API client: tRPC; organism hooks such as `useFleetSnapshot`. shadcn/ui on Base UI. Client route parts such as `inbox/inbox-page.tsx`.
- The operator's session is an httpOnly cookie. Destructive actions confirm as the blueprint says.

Enforced by lint (`eslint.config.js`): layer imports, no tRPC in atoms and molecules, browser storage, manual memoisation, index keys, jsx-a11y.
