# 0033 Console logic on the server

- Logic runs on the server, by default and always. The browser holds only UI interaction and animations: it renders the data it is given and sends what the operator does.
- Logic means calling the fleet or a plugin, parsing and checking their answers, deciding what is allowed or valid, and turning outside data into typed data. It runs on the web app's server (server components, route handlers) or behind the tRPC API, never in a client component.
- The web app's server calls squadrons and the trierarch plugin and parses their answers. The browser gets only the data a page renders. Which plugins are on or off reaches the browser only as what a page shows.
- `@aeolus-fleet/common` and zod are in no client chunk; the browser may import only types from them. The bundle analyzer (`next experimental-analyze`) is how this is checked.

Why: checks in the browser shipped zod and `common` to every page, and showed the browser which plugins a fleet has on or off. The leak is the reason; the smaller pages follow from it.

Rejected:
- Parsing plugin answers in the browser with `zod/mini`: smaller, but the logic and the leak stay in the browser.
- Keeping client-side checks beside the server's: the same rule in two places, and logic in the browser.
