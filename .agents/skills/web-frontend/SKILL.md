---
name: web-frontend
description: Use for React and Next.js web app changes. Structure, state, React rules.
---

# Web frontend

Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: the installed version may differ from training data.

Logic runs on the server by default: data calls, parsing and checks run on the app's server or behind the API; the browser holds only UI interaction and animations, and never imports validation libraries.

- Vertical by default: split by feature, not by type. Atomic design inside it.
- `app/`: routes only (page, layout, `loading.tsx` skeleton, `error.tsx`, a route's client part beside its server `page.tsx`), composing features.
- Templates are the page layouts in `app/` (route layouts), composing features.
- `components/`: shared atoms, molecules and organisms. Props only: no data fetching, no feature knowledge; actions and data come in as props. shadcn/ui first; a custom component needs a PR note why.
- `features/<feature>/`: one folder owns that feature's atoms, molecules, organisms, hooks and server parts. Its organisms get data through its hooks wrapping the API client.
- Something moves to shared when a second feature needs it. `lib/` for shared non-UI code.
- Server components by default; `'use client'` as low as possible.
- State: server data via the API client plus TanStack Query, never copied into `useState`; view state in URL params; forms with React Hook Form, live hints from shared rules, the server deciding on submit; local UI state in the owning component. No global store.
- Mutations in their hook, which invalidates. Show pending, success, failure; failures keep user input. Destructive actions confirm.
- Never keep a password in the browser beyond the sign-in form; the session is an httpOnly cookie.
- `useEffect` only for outside systems (WebSocket). No manual memoisation, no index keys, no browser storage for server data.
- Keyboard reachable, accessible names, status never by colour alone. `data-testid="{area}-{element}"` on elements tests touch.
- Storybook: a story per meaningful state.
