---
name: web-frontend
description: Mandatory for changes under packages/web. Console structure, state, React rules.
---

# Web console

The console is `argo`. No domain logic: every rule is on the server via tRPC. Look from `docs/design.md`, behaviour from the blueprint.

- `app/`: routes only (page, layout, `loading.tsx` skeleton, `error.tsx`). `components/{atoms,molecules,organisms,templates}`, `lib/`.
- Atoms and molecules: props only, no tRPC. Organisms: data through a hook (`useFleetSnapshot`) wrapping tRPC. shadcn/ui first; a custom atom needs a PR note why.
- Server components by default; `'use client'` as low as possible.
- State: server data via tRPC plus TanStack Query, never copied into `useState`; view state in URL params; forms with React Hook Form plus the `common` Zod schema; local UI state in the owning component. No global store.
- Mutations in their hook, which invalidates. Show pending, success, failure; failures keep user input. Destructive actions confirm as the blueprint says.
- Never store `argo`'s secret in the browser; the session is an httpOnly cookie.
- `useEffect` only for outside systems (WebSocket). No manual memo unless measured. Keys from ids.
- Keyboard reachable, accessible names, status never by colour alone. `data-testid="{area}-{element}"` on elements tests touch.
- Storybook from the console work on: a story per meaningful state.
