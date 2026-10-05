# 0025 Console analytics

- The console's usage analytics are off by default. A self-hosted console sends nothing anywhere and needs no configuration.
- A hosted install turns them on with `AEOLUS_HOSTED_ANALYTICS_PROVIDER`, `AEOLUS_HOSTED_ANALYTICS_KEY` and `AEOLUS_HOSTED_ANALYTICS_HOST` (https), read by the web app's server. The only provider is `posthog`.
- The console calls a small port, `track(event)`, which does nothing while analytics is off. On, the browser posts each event to the web app's own `/api/analytics`. That route:
  - checks the event against a closed list and drops anything else;
  - asks the server which kind of session sent it (`operator` or `viewer`), and drops events from no live session;
  - hands the event to the provider's adapter, on the web app's server.

  The browser never talks to the provider, and no provider code runs in the console.
- The events: `pageview` (the route's pattern, such as `/ships/[shipId]`, never an id), `tour_started`, `tour_step_reached` (step, total), `tour_skipped` (step), `tour_finished`, `ship_commissioned` and `squadron_formed` (role count). Each also carries the session kind, and nothing else: no names, ids, payloads or typed text.
- Visitors are anonymous: an HMAC of the session cookie with a salt that changes every UTC day and lives only in the web app's memory, so one day cannot be joined to the next. No cookies, no browser storage. The provider sees only the web app's server's address, and makes no person profiles.

Why: the hosted service needs to see how the console and its tour are used, without the open-source console depending on a vendor or sending anything by default. A server-side adapter using fetch adds nothing to the browser bundle, no dependency for self-hosters, and no third party in the browser.

Rejected:
- The provider's browser SDK: a dependency for every install, and the browser talking to a third party.
- A separate analytics package: a fourth published package for one small adapter.
- A script injected by the hosted install: outside code in the console (decision 0023, 0024).
