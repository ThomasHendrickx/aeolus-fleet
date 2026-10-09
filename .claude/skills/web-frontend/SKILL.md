---
name: web-frontend
description: Mandatory for changes under packages/console. Console structure, state, React rules.
---

# Web console

Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: Next.js 16 differs from training data.

The console is `argo`. Logic runs on the server, by default and always (decision 0033): plugin calls, parsing answers and checks run on the web app's server or behind tRPC; the browser holds only UI interaction and animations, and imports only types from `common` and zod. Look from `docs/design/` (read `conventions.md` first, then only the parts you build), behaviour from the blueprint. Theme from `packages/console/app/tokens.css`, the single copy of the tokens.

- `app/`: routes only (page, layout, `loading.tsx` skeleton, `error.tsx`). `components/{atoms,molecules,organisms,templates}`, `lib/`.
- Atoms and molecules: props only. Organisms: data through a hook (`useFleetSnapshot`) wrapping tRPC. shadcn/ui first; a custom atom needs a PR note why.
- Server components by default; `'use client'` as low as possible.
- State: server data via tRPC plus TanStack Query, never copied into `useState`; view state in URL params; forms with React Hook Form plus the `common` Zod schema; local UI state in the owning component. No global store.
- Mutations in their hook, which invalidates. Show pending, success, failure; failures keep user input. Destructive actions confirm as the blueprint says.
- Never keep the operator's password in the browser beyond the sign-in form; the session is an httpOnly cookie.
- `useEffect` only for outside systems (WebSocket).
- Keyboard reachable, accessible names, status never by colour alone. `data-testid="{area}-{element}"` on elements tests touch.
- Storybook from the console work on: a story per meaningful state.

Enforced by lint (`eslint.config.js`): layer imports, no tRPC in atoms and molecules, browser storage, manual memoisation, index keys, jsx-a11y.
