---
name: web-frontend
description: Use for React and Next.js web app changes. Structure, state, React rules.
---

# Web frontend

Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: the installed version may differ from training data.

The server decides: data calls, business rules and checks run on the server or behind the API. Browser checks are live hints only.

Structure: vertical by feature, atomic design inside it. The repo's companion skill names the root folder.
- One folder per feature:
  - `ui/`: its atoms, molecules and organisms. Props only: no data fetching, no store, no API client.
  - `hooks/`: the feature's ports. A hook hides whether data is server or client state and returns only what consumers need.
  - `state/`: containers that connect hooks to `ui/`. Composition only.
  - `services/` (optional): pure frontend logic such as formatters and view-model builders. No React, no API client.
- Dependencies flow inward: `state/` uses `hooks/` and `ui/`; `hooks/` use `services/`.
- Shared atoms, molecules and organisms are props only. A part moves to shared when a second feature needs it.
- Route files (page, layout, `loading`, `error`) only compose features; route layouts are the templates.
- shadcn/ui first; a custom atom needs a PR note why.
- Server components by default; `'use client'` as low as possible.

State:
- Server data via the API client plus TanStack Query, never copied into local state. URL-worthy view state in search params. Forms with React Hook Form. Local UI state in the owning component. No global store.
- Mutations live in their hook, which invalidates. Show pending, success, failure; failures keep user input. Destructive actions confirm.
- `useEffect` only to sync with outside systems (a WebSocket, a browser API). Derive values in render. No manual memoisation, no index keys, no browser storage for server data.
- The session is an httpOnly cookie; a password lives only in the sign-in form.

Quality:
- Keyboard reachable, accessible names, status never by colour alone. `data-testid="{area}-{element}"` on elements tests touch.
- Storybook: a story per meaningful state of each `ui/` part.
