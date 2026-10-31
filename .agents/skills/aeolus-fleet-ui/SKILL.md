---
name: aeolus-fleet-ui
description: Mandatory with web-frontend for changes under packages/ui. The parts every Aeolus web app shows, and what ui may know.
---

# UI in aeolus-fleet

Load with `web-frontend`.

- `@aeolus-fleet/ui` holds a part two Aeolus apps both show (docs/design/ui-package/README.md, UP2); a part one app alone shows stays in that app.
- Pure UI, props only: each app reads its data behind its own hooks and hands the part what to show. Logic that is not UI (which apps exist, who may do what) stays out, as a React-free helper in `@aeolus-fleet/common/rules` where apps share it.
- Layout: `src/atoms`, `src/molecules`, `src/organisms`, one part per file with its stories and tests beside it; `'use client'` on each interactive part's file; every part exported from `src/index.ts`.
- Look from `docs/design/` (read `conventions.md` first, then only the parts you build). `src/tokens.css` is the single copy of the design tokens and `src/theme.css` their Tailwind mapping; an app imports both through `theme.css`.
- Stories run in ui's own Storybook (`@storybook/react-vite`) and as `ui:stories`; a part that needs a link takes it through Base UI's `render` prop from the app.
- Test ids are fixed and named for the part (`avatar-menu-session`); where one part shows twice, the app scopes each in a container with its own id.

Enforced by lint (`eslint.config.js`, proven in `lint/ui.test.ts`): no app and no `@aeolus-fleet` package but common, common by `import type` only; no zod, `node:`, tRPC, TanStack or `next/`; no fetch or browser storage; a layer imports only below itself; the console's React rules. The train check refuses any `@aeolus-fleet` package but common in ui's manifest.
