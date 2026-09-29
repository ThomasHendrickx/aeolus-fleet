---
name: web-frontend
description: MANDATORY for any change under packages/web. How the Aeolus console is built with Next.js App Router, React, tRPC with TanStack Query, shadcn/ui on Base UI and atomic design: server versus client components, state placement, forms, errors, accessibility. Load together with the typescript skill.
---

# The Aeolus console

The console is the operator crewing the ship `argo`. It owns no domain logic: every rule lives on the server and is reached through the tRPC router. Look and feel come from the design canvas (`docs/design.md`); behaviour comes from the blueprint.

## Structure: atomic design

```
packages/web/
  app/                    routes only: page.tsx, layout.tsx, loading.tsx, error.tsx
  components/atoms/       shadcn/ui primitives on Base UI, unchanged or lightly themed
  components/molecules/   small compositions: StatusBadge, StartingPromptBlock
  components/organisms/   sections with their own data: ShipTable, MessageSheet
  components/templates/   page layouts for desktop and phone
  lib/                    tRPC client, formatters, pure helpers
```

- Atoms and molecules are presentational: props in, markup out. They never call tRPC.
- Organisms own their data through a hook (`useFleetSnapshot`) that wraps the tRPC query or mutation. The organism passes plain props down.
- Routes compose templates and organisms. A `page.tsx` holds no logic beyond reading params and choosing what to render.
- Use shadcn/ui first. A custom atom is allowed only when no shadcn primitive or composition covers it; say why in the PR.
- Files kebab-case, components PascalCase, one component per file.

## Server and client

- Server components by default. Add `'use client'` only for interactivity (forms, live updates, menus), as low in the tree as possible.
- Sign-in state lives in the httpOnly session cookie; the browser never stores `argo`'s secret, not in state, not in storage.
- Server data comes from tRPC through TanStack Query. Never copy server data into `useState`.

## State placement

| State | Where |
| --- | --- |
| Server data | tRPC with TanStack Query |
| Shareable view state (filters, selected ship) | URL search params |
| Form input | React Hook Form with the Zod schema from `common` |
| Local UI state (open, hover) | `useState` in the component that owns it |

No global client store until a real need shows up.

## Mutations

- Each mutation lives in its hook, which invalidates the queries it affects. Components call `mutate`, never invalidate.
- Every mutation shows pending, success and failure. Failures say what happened and what to do next, and never clear the user's input.
- Destructive actions confirm first, as the blueprint prescribes (typed ship name for retiring with an unprocessed inbox).

## React rules

- A component renders. Logic longer than a few lines moves to a hook or a pure helper in `lib/`.
- `useEffect` only to sync with something outside React (the WebSocket subscription). Never to fetch, never to derive a value.
- No hand-written `useMemo`, `useCallback` or `React.memo` unless a measured problem needs it.
- Keys come from ids, never array indexes.
- Every route has `loading.tsx` (a skeleton in the shape of the content) and `error.tsx`.

## Accessibility and testing

- Every interactive element is reachable by keyboard and has an accessible name. Status is never shown by colour alone.
- Interactive elements the end-to-end tests touch get a `data-testid` (`{area}-{element}`).
- Pure helpers get unit tests. Hooks are tested through their behaviour. Critical journeys get a Playwright test.
- Storybook arrives with the console work: from then on every atom, molecule and organism has a story per meaningful state.
