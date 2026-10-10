# 0033 Console logic on the server

- Logic runs on the server, by default and always. The browser holds only UI interaction and animations: it renders the data it is given and sends what the operator does.
- Logic means calling the fleet or a plugin, parsing and checking their answers, deciding what is allowed, and turning outside data into typed data. It runs on the web app's server (server components, server functions, route handlers) or behind the tRPC API, never in a client component.
- Reads go through route handlers (`/api/reads/<name>`), changes through server functions. Next.js runs a browser's server functions one at a time, so a read through one waits behind a running change. The browser trusts a read's answer in one place (`lib/fetch-console-read.ts`), which checks only that an answer came.
- The web app's server calls squadrons and the trierarch plugin and parses their answers. The browser gets only the data a page renders. Which plugins are on or off reaches the browser only as what a page shows.
- Live form hints stay in the browser: they are UI and change no outcome. They use the pure rules in `@aeolus-fleet/common/rules`, which has no zod and on which common's schemas are built, so no rule is copied. The server stays the authority on submit.
- Zod, the plugin clients and plugin answers are in no client chunk. From `@aeolus-fleet/common` the browser imports only types and `@aeolus-fleet/common/rules`; limits and closed sets it shows come down from the root layout. The bundle analyzer (`next experimental-analyze`) is how this is checked.

Why: checks in the browser shipped zod and `common` to every page, and showed the browser which plugins a fleet has on or off. The leak is the reason; the smaller pages follow from it.

Rejected:
- Parsing plugin answers in the browser with `zod/mini`: smaller, but the logic and the leak stay in the browser.
- Dropping live hints for checks on submit only: hints are UX, not logic, and expose nothing.
- Copying the hint rules into the console: two sources for one rule.
- Reads through server functions: a poll queues behind a slow change, and the page looks stale while it runs.
