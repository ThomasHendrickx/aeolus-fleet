# Timings and limits

Every fixed timing and limit in Aeolus, by package, for debugging. This page holds no rules of its own: each line points to the constant that sets it and the decision, issue or doc that says why. When a value here and its source disagree, the source wins; fix this page.

A default that configuration may change names its setting. Unit helpers (`SECOND_MS`, `MINUTES_PER_HOUR` and the like) and the lengths of random id suffixes are left out.

## Common: the limits every package shares

Defined in `@aeolus-fleet/common`, checked by core on every call and by the clients before they call.

### Sizes

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 64 KB (`64 * 1024` bytes, UTF-8) | A message payload; also a `CHECK` on `messages.payload` | [rules/payload.ts](../packages/common/src/rules/payload.ts) `PAYLOAD_MAX_BYTES`; [init migration](../packages/core/src/adapters/prisma/migrations/20260929124818_init/migration.sql) `messages_payload_max_64kb` | [0006](decisions/0006-payload-limit.md) |
| 16 KB | A report's details, checked on the result of a merge patch | [schemas/report.ts](../packages/common/src/schemas/report.ts) `REPORT_DETAILS_MAX_BYTES` | [0028](decisions/0028-report-details.md) |
| 16 KB | A crew request's settings | [schemas/crew-request.ts](../packages/common/src/schemas/crew-request.ts) `CREW_REQUEST_SETTINGS_MAX_BYTES` | [0029](decisions/0029-crew-request.md) |
| 8192 bytes | A crew's first prompt, after squadrons fills its parameters | [trierarch/crew-settings.ts](../packages/common/src/trierarch/crew-settings.ts) `FIRST_PROMPT_MAX_BYTES` | [0027](decisions/0027-crew-settings.md), [trierarch.md](trierarch.md#the-crew-request), #371 |

### Lengths

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 48 characters | A ship name or type; squadron ids and template handles too | [rules/ship-handle.ts](../packages/common/src/rules/ship-handle.ts) `SHIP_HANDLE_MAX_LENGTH` | [blueprint.md](blueprint.md) |
| 63 characters (a-z, 0-9, -) | A label key or value; machine labels too | [rules/label-handle.ts](../packages/common/src/rules/label-handle.ts) `LABEL_HANDLE_MAX_LENGTH` | [0031](decisions/0031-labels.md) |
| 200 characters, one line | A report note | [schemas/report.ts](../packages/common/src/schemas/report.ts) `REPORT_NOTE_MAX_LENGTH` | [blueprint.md](blueprint.md) |
| 200 characters, one line | A crew request's reason and a give-back's reason (the trierarch and the trierarch plugin cut theirs to it) | [schemas/crew-request.ts](../packages/common/src/schemas/crew-request.ts) `CREW_REQUEST_REASON_MAX_LENGTH` | [0029](decisions/0029-crew-request.md), #382 |
| 500 characters | A ship note | [schemas/fleet.ts](../packages/common/src/schemas/fleet.ts) `SHIP_NOTE_MAX_LENGTH` | none recorded |
| 256 characters | A content type | [schemas/message.ts](../packages/common/src/schemas/message.ts) `CONTENT_TYPE_MAX_LENGTH` | none recorded |
| 100 characters | A model id on a send | [schemas/message.ts](../packages/common/src/schemas/message.ts) `MODEL_MAX_LENGTH` | [0018](decisions/0018-model-and-harness.md) |
| 50 characters | A harness | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `HARNESS_MAX_LENGTH` | [0018](decisions/0018-model-and-harness.md) |
| 100 characters | An OTHER location's description | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `LOCATION_DESCRIPTION_MAX_LENGTH` | none recorded |
| 256 characters | A ship secret passed to `register` | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `SHIP_SECRET_MAX_LENGTH` | none recorded |
| 256 characters | An idempotency key | [schemas/idempotency-key.ts](../packages/common/src/schemas/idempotency-key.ts) `IDEMPOTENCY_KEY_MAX_LENGTH` | none recorded |
| 254 characters | An operator email | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_EMAIL_MAX_LENGTH` | none recorded |
| 1024 characters | An operator password | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_PASSWORD_MAX_LENGTH` | [0016](decisions/0016-no-policy.md) |
| 12 characters | A new operator password, at least: `fleet:init` and `operator:reset-password` (sign-in checks no minimum) | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_PASSWORD_MIN_LENGTH` | #824 |
| 256 characters | A sign-in ticket | [schemas/console.ts](../packages/common/src/schemas/console.ts) `SIGN_IN_TICKET_MAX_LENGTH` | none recorded |
| 100 characters | A trierarch repository, folder, option or value name | [trierarch/names.ts](../packages/common/src/trierarch/names.ts) `TRIERARCH_NAME_MAX_LENGTH` | none recorded |
| 300 characters | A notice's text | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `NOTICE_TEXT_MAX` | [0023](decisions/0023-notices.md) |
| 40 characters | A notice link's label | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `NOTICE_LINK_LABEL_MAX` | [0023](decisions/0023-notices.md) |
| 64 characters | A notice id (inline pattern) | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) | [0023](decisions/0023-notices.md) |
| 80 characters | A guide step's title | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) `GUIDE_STEP_TITLE_MAX` | [0024](decisions/0024-guide.md) |
| 300 characters | A guide step's text | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) `GUIDE_STEP_TEXT_MAX` | [0024](decisions/0024-guide.md) |
| 200 characters | A guide step's page path | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) `GUIDE_STEP_PATH_MAX` | [0024](decisions/0024-guide.md) |
| 64 characters | A guide step's anchor (inline pattern) | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) | [0024](decisions/0024-guide.md) |
| 80 characters | The headline a message to argo opens with; the trierarch, squadrons and the aeolus plugin cut a longer one with an ellipsis | [fleet/argo-message.ts](../packages/common/src/fleet/argo-message.ts) `ARGO_HEADLINE_MAX_LENGTH` | [blueprint.md](blueprint.md#operator-inbox), #849 |
| 1 to 15 digits | An event stream position, kept below 2^53 | [schemas/fleet.ts](../packages/common/src/schemas/fleet.ts) `STREAM_POSITION_PATTERN` | none recorded |
| 26 characters after the prefix; time up to 2^48 - 1 ms | A prefixed id | [ids/index.ts](../packages/common/src/ids/index.ts) `BODY_PATTERN`, `MAX_TIME` | [0005](decisions/0005-prefixed-ids.md) |

### Counts

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 1 to 10, default 1 | Deliveries one receive hands over | [schemas/delivery.ts](../packages/common/src/schemas/delivery.ts) `RECEIVE_MAX_UPPER_BOUND`, `RECEIVE_MAX_DEFAULT` | [architecture.md](architecture.md), [blueprint.md](blueprint.md) |
| 100, default 100 | Events one `fleet.follow` returns | [schemas/follow.ts](../packages/common/src/schemas/follow.ts) `FOLLOW_MAX_LIMIT`, `FOLLOW_MAX_DEFAULT` | none recorded |
| 100 | Reach refusals one read returns | [schemas/network.ts](../packages/common/src/schemas/network.ts) `REACH_REFUSALS_READ_MAX` | [0034](decisions/0034-network-rules.md) |
| 50 | Values one label defines | [schemas/label.ts](../packages/common/src/schemas/label.ts) `LABEL_VALUES_MAX` | [0031](decisions/0031-labels.md) |
| 20 | Label values one ship carries; also machine labels in crew settings and terms in one network rule selector | [schemas/label.ts](../packages/common/src/schemas/label.ts) `SHIP_LABELS_MAX` | [0031](decisions/0031-labels.md), [0034](decisions/0034-network-rules.md) |
| 200 | Network rules: argo's plus the declared ones | [schemas/network.ts](../packages/common/src/schemas/network.ts) `NETWORK_RULES_MAX` | [0037](decisions/0037-declared-network-rules.md) |
| 20 | Network rules one ship declares | [schemas/network.ts](../packages/common/src/schemas/network.ts) `DECLARED_NETWORK_RULES_MAX` | [0037](decisions/0037-declared-network-rules.md) |
| 100 | Pending clear requests per trierarch | [schemas/clear-request.ts](../packages/common/src/schemas/clear-request.ts) `CLEAR_REQUESTS_PER_TRIERARCH_MAX` | [0032](decisions/0032-clear-request.md) |
| 5 | Notices at once | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `MAX_NOTICES` | [0023](decisions/0023-notices.md) |
| 3 | Links per notice | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `MAX_NOTICE_LINKS` | [0023](decisions/0023-notices.md) |
| 1 to 10 | Guide steps | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) `MAX_GUIDE_STEPS` | [0024](decisions/0024-guide.md) |

### Timings

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 0 to 25 s | The wait an inbox check may ask for | [schemas/delivery.ts](../packages/common/src/schemas/delivery.ts) `INBOX_WAIT_MAX_SECONDS` | [blueprint.md](blueprint.md) |
| 0 to 25 s | The wait a `fleet.follow` may ask for | [schemas/follow.ts](../packages/common/src/schemas/follow.ts) `FOLLOW_WAIT_MAX_SECONDS` | none recorded |
| 60 s to 86 400 s (one day) | After how long without a call a networking plugin may declare itself not responding | [schemas/network.ts](../packages/common/src/schemas/network.ts) `NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS`, `..._MAX_SECONDS` | [0035](decisions/0035-networking-plugin.md) |
| 1, 2, 4, 8 s, each drawn between half and all of it | The waits before a fleet client calls again while the fleet answers busy: 5 calls in all. Squadrons, the trierarch and both plugins use it; the aeolus plugin keeps a copy (below) | [fleet/index.ts](../packages/common/src/fleet/index.ts) `FLEET_BUSY_WAITS_MS`; [fleet/busy-wait.ts](../packages/common/src/fleet/busy-wait.ts) `busyWaitMs` | [architecture.md](architecture.md), #734 |

## Core

### Messaging

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 25 s | How long a receive waits on an empty inbox before it answers empty (long poll) | [messaging/receive-deliveries.ts](../packages/core/src/domain/messaging/receive-deliveries.ts) `RECEIVE_WAIT_MS` | [architecture.md](architecture.md), [blueprint.md](blueprint.md) |
| 5th attempt | A delivery received this often without an ack is refused, handed to no one: it becomes undeliverable and shows in needs attention | [messaging/delivery.ts](../packages/core/src/domain/messaging/delivery.ts) `UNDELIVERABLE_AT_ATTEMPT` | [blueprint.md](blueprint.md), [architecture.md](architecture.md) |
| 10 min | A delivery handed on a pushed ship and not confirmed this long is overdue: argo is told once per lease and oldest delivery, whatever the turn | [messaging/overdue.ts](../packages/core/src/domain/messaging/overdue.ts) `NOT_CONFIRMED_MINUTES` | [0040](decisions/0040-delivery-protocol.md), #586 |
| 10 min | A delivery pending or received for a pushed ship this long while its session is idle is overdue | [messaging/overdue.ts](../packages/core/src/domain/messaging/overdue.ts) `IDLE_MINUTES` | [0040](decisions/0040-delivery-protocol.md), #586 |
| 60 min | The same while its session is busy | [messaging/overdue.ts](../packages/core/src/domain/messaging/overdue.ts) `BUSY_MINUTES` | [0040](decisions/0040-delivery-protocol.md), #586 |
| 30 s | How often core passes the 10 and 60 minute clocks, so argo is told within this of a clock running out | [app.ts](../packages/core/src/app.ts) `OVERDUE_PASS_MS` | [0040](decisions/0040-delivery-protocol.md), [architecture.md](architecture.md) |
| 00:00 UTC | When the daily message count starts again | [shared/utc-day.ts](../packages/core/src/domain/shared/utc-day.ts) `nextUtcDayStart` | [0020](decisions/0020-installation.md) |
| 7 days | The installation's message window, counted per UTC day | [registry/installation-fleet.ts](../packages/core/src/domain/registry/installation-fleet.ts) `MESSAGE_WINDOW_DAYS` | [0020](decisions/0020-installation.md), [blueprint.md](blueprint.md) |
| none by default | Ships per fleet, messages per day, fleets per installation | [registry/limits.ts](../packages/core/src/domain/registry/limits.ts) `NO_INSTALLATION_SETTINGS`; set by the installation | [0020](decisions/0020-installation.md) |

### Reads

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 1000 events | Missed events replayed to a browser before it must reload | [shared/read-fleet-events.ts](../packages/core/src/domain/shared/read-fleet-events.ts) `REPLAY_LIMIT` | [architecture.md](architecture.md) |
| 200 | Messages on a ship's page | [shared/read-ship-messages.ts](../packages/core/src/domain/shared/read-ship-messages.ts) `MESSAGES_LIMIT` | none recorded |
| 120 characters | A payload's preview | [shared/read-ship-messages.ts](../packages/core/src/domain/shared/read-ship-messages.ts) `PREVIEW_LENGTH` | none recorded |
| 200 | Events on a ship's timeline | [shared/read-ship-timeline.ts](../packages/core/src/domain/shared/read-ship-timeline.ts) `TIMELINE_LIMIT` | none recorded |
| 100 characters | A fleet name, trimmed | [registry/fleet.ts](../packages/core/src/domain/registry/fleet.ts) `FLEET_NAME_MAX_LENGTH` | none recorded |

### Sessions and sign-in

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 30 days, renewed on each use | An operator's console session | [identity/console-session.ts](../packages/core/src/domain/identity/console-session.ts) `CONSOLE_SESSION_IDLE_LIMIT_MS` | [0012](decisions/0012-operator-is-a-ship.md), [architecture.md](architecture.md) |
| 2 hours after last use | A viewer session | [identity/console-session.ts](../packages/core/src/domain/identity/console-session.ts) `VIEWER_SESSION_IDLE_LIMIT_MS` | [0022](decisions/0022-viewer-ship.md) |
| 24 hours at most | A viewer session | [identity/console-session.ts](../packages/core/src/domain/identity/console-session.ts) `VIEWER_SESSION_LIFETIME_MS` | [0022](decisions/0022-viewer-ship.md) |
| 2 minutes | A sign-in ticket stays valid | [identity/sign-in-ticket.ts](../packages/core/src/domain/identity/sign-in-ticket.ts) `SIGN_IN_TICKET_VALID_MS` | [0020](decisions/0020-installation.md), [blueprint.md](blueprint.md) |
| 10 a minute per client (default) | Sign-in attempts | [http/server.ts](../packages/core/src/adapters/http/server.ts) `DEFAULT_SIGN_IN_RATE_LIMIT` | none recorded |
| 10 a minute per client (default) | Failed `register` attempts | [http/server.ts](../packages/core/src/adapters/http/server.ts) `DEFAULT_REGISTER_RATE_LIMIT` | [0015](decisions/0015-ship-identity-per-conversation.md) |
| Argon2id, 19 MiB, 2 passes, parallelism 1 | The cost of hashing a password or secret | [crypto/passwords.ts](../packages/core/src/adapters/crypto/passwords.ts) `COST` | none recorded |
| 32 random bytes | Every crew token, session token, sign-in ticket and ship secret | [crypto/secrets.ts](../packages/core/src/adapters/crypto/secrets.ts) (inline) | [0002](decisions/0002-opaque-ship-secret.md) |

### Database

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 10 s | Waiting for a pool connection (pg's default pool size) | [prisma/client.ts](../packages/core/src/adapters/prisma/client.ts) `CONNECTION_WAIT_MS` | [architecture.md](architecture.md) |
| 5 s | An interactive transaction, then rolled back and refused as busy | [prisma/client.ts](../packages/core/src/adapters/prisma/client.ts) `TRANSACTION_TIME_MS` | [architecture.md](architecture.md) |
| 30 s | A bulk transaction: a fleet delete, a ship retire | [prisma/client.ts](../packages/core/src/adapters/prisma/client.ts) `BULK_TRANSACTION_TIME_MS` | [architecture.md](architecture.md) |
| 1 s, doubling, at most 30 s | Reconnecting the `LISTEN` connection | [prisma/delivery-notices.ts](../packages/core/src/adapters/prisma/delivery-notices.ts) `RECONNECT_DELAY_MS`, `RECONNECT_DELAY_MAX_MS` | none recorded |
| 10 s (Prisma's), tried again without end | Prisma Migrate's advisory lock at start | [prisma/migrate.ts](../packages/core/src/adapters/prisma/migrate.ts) `LOCK_TIMED_OUT` | [architecture.md](architecture.md) |

### HTTP

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 1 MiB | A request body | [http/server.ts](../packages/core/src/adapters/http/server.ts) `BODY_LIMIT_BYTES` | [0006](decisions/0006-payload-limit.md) |
| 5000 characters | A route parameter (tRPC batch paths) | [http/server.ts](../packages/core/src/adapters/http/server.ts) `maxParamLength` (inline) | none recorded |
| 30 s ping, 10 s for the pong | WebSocket subscription keep-alive | [http/server.ts](../packages/core/src/adapters/http/server.ts) `KEEP_ALIVE` | none recorded |
| 600 s | How long a browser keeps a CORS preflight | [http/server.ts](../packages/core/src/adapters/http/server.ts) `PREFLIGHT_MAX_AGE_S` | none recorded |
| until the session ends | The session cookie's `Max-Age` | [http/request-credentials.ts](../packages/core/src/adapters/http/request-credentials.ts) (inline) | [0012](decisions/0012-operator-is-a-ship.md), [0022](decisions/0022-viewer-ship.md) |
| at least 32 characters | `INSTALLATION_TOKEN`, when set | [config.ts](../packages/core/src/config.ts) `INSTALLATION_TOKEN_MIN_LENGTH` | [0020](decisions/0020-installation.md) |

## Console

### Calls from the web app's server

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 30 s | A plugin call from the web app's server | [lib/plugin-call.ts](../packages/console/lib/plugin-call.ts) `TIMEOUT_MS` | [0033](decisions/0033-console-logic-on-the-server.md) |
| 10 s | Connecting a plugin | [lib/plugin-calls.ts](../packages/console/lib/plugin-calls.ts) `TIMEOUT_MS` | none recorded |
| 10 s | Redeeming a sign-in ticket | [app/sign-in/ticket/route.ts](../packages/console/app/sign-in/ticket/route.ts) `REDEEM_TIMEOUT_MS` | [0020](decisions/0020-installation.md) |
| 3 s | The proxy's session check | [lib/console-gate.ts](../packages/console/lib/console-gate.ts) `SESSION_CHECK_TIMEOUT_MS` | [0012](decisions/0012-operator-is-a-ship.md) |
| 3 s | `/health` | [lib/health.ts](../packages/console/lib/health.ts) `TIMEOUT_MS` | #454 |
| 3 s | `/api/version` of core and the plugins | [lib/version.ts](../packages/console/lib/version.ts) `TIMEOUT_MS` | #49, #432, #478 |
| 3 s | The trierarch plugin's `/api/version` | [lib/trierarch-plugin-reads.ts](../packages/console/lib/trierarch-plugin-reads.ts) `VERSION_TIMEOUT_MS` | #332 |
| 1.5 s | Reading the account's theme before rendering with System | [lib/theme-of-session.ts](../packages/console/lib/theme-of-session.ts) `ACCOUNT_TIMEOUT_MS` | none recorded |
| 3 s | An analytics event's session check, then the event is dropped | [lib/analytics-route.ts](../packages/console/lib/analytics-route.ts) `SESSION_CHECK_TIMEOUT_MS` | [0025](decisions/0025-console-analytics.md) |
| 3 s | Sending an analytics event to PostHog | [lib/analytics-posthog.ts](../packages/console/lib/analytics-posthog.ts) `CAPTURE_TIMEOUT_MS` | [0025](decisions/0025-console-analytics.md) |
| 100 characters; steps 1 to 10; 0 to 100 roles | An analytics event's route, guide step and role count | [lib/analytics-event.ts](../packages/console/lib/analytics-event.ts) `ROUTE_MAX_LENGTH`, `GUIDE_STEPS_MAX`, `ROLES_MAX` | [0025](decisions/0025-console-analytics.md) |

### Refreshing

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 30 s | The fleet list and ships, for last seen (no live event carries it) | [lib/fleet.ts](../packages/console/lib/fleet.ts), [lib/ship.ts](../packages/console/lib/ship.ts) `LAST_SEEN_REFRESH_MS` | none recorded |
| 60 s | Fleet limits, so the 00:00 UTC reset clears the notice | [lib/fleet-limits.ts](../packages/console/lib/fleet-limits.ts) (inline) | [0020](decisions/0020-installation.md) |
| 5 s | Squadrons' lists and catalogue | [lib/squadrons-api.ts](../packages/console/lib/squadrons-api.ts) `REFRESH_MS` | none recorded |
| 10 s | The machine list | [lib/trierarch-plugin.ts](../packages/console/lib/trierarch-plugin.ts) `MACHINES_REFRESH_MS` | none recorded |
| 10 s | Pending clear requests | [features/trierarchs/hooks/clear-requests.ts](../packages/console/features/trierarchs/hooks/clear-requests.ts) `CLEAR_REQUESTS_REFRESH_MS` | [0032](decisions/0032-clear-request.md) |
| 10 s | The clock that moves relative times on | [lib/now.ts](../packages/console/lib/now.ts) `TICK_MS` | none recorded |
| 3 retries, none on UNAUTHORIZED or FORBIDDEN | A failed query | [app/providers.tsx](../packages/console/app/providers.tsx) `retry` | none recorded |

### What a page shows

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| under 1 minute, then up to 15 minutes, then long ago | Last seen: fresh, a while, long ago | [features/fleet/lib/last-seen.ts](../packages/console/features/fleet/lib/last-seen.ts) `MINUTE_MS`, `A_WHILE_MS` | [design/conventions.md](design/conventions.md) |
| late after 1 interval, silent after 3 | A squadron member's check-in, as squadrons judges it (below) | [lib/squadrons-view.ts](../packages/console/lib/squadrons-view.ts) `LATE_AFTER_INTERVALS`, `SILENT_AFTER_INTERVALS` | [squadrons.md](squadrons.md) |
| from 15 labels | A ship page shows "n of 20" | [lib/labels.ts](../packages/console/lib/labels.ts) `SHOWN_COUNT_FROM` | [0031](decisions/0031-labels.md) |
| 2 label chips, then "+n" | Labels on a ship | [components/molecules/ship-labels.tsx](../packages/console/components/molecules/ship-labels.tsx) `SHOWN`; [features/ship/organisms/ship-labels-edit.tsx](../packages/console/features/ship/organisms/ship-labels-edit.tsx) `SHOWN` | [design/README.md](design/README.md) |
| 22 characters | Labels beside a name in the fleet table, then "+n" | [features/fleet/organisms/fleet-table.tsx](../packages/console/features/fleet/organisms/fleet-table.tsx) `ROW_LABELS_WIDTH` | #102 |
| 8 ships | Ships the command palette lists before anything is typed | [features/commands/services/command-palette.ts](../packages/console/features/commands/services/command-palette.ts) `SHIPS_BEFORE_QUERY` | none recorded |
| 1.5 s | A copy button shows its check | [components/atoms/copy-button.tsx](../packages/console/components/atoms/copy-button.tsx) `COPIED_FOR_MS` | [design/README.md](design/README.md) |
| 500 ms | A tooltip opens after hovering | [components/atoms/tooltip.tsx](../packages/console/components/atoms/tooltip.tsx) `HOVER_DELAY_MS` | [design/README.md](design/README.md) |
| 5 s; errors until dismissed | A toast closes by itself | [components/atoms/toast.tsx](../packages/console/components/atoms/toast.tsx) `SUCCESS_DURATION_MS` | none recorded |

## Squadrons

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 30 s | The flagships' rescan: new receives, stand-downs, recovery, labels and rules | [bin/aeolus-squadrons.ts](../packages/squadrons/src/bin/aeolus-squadrons.ts) `FLAGSHIP_RESCAN_MS` | [squadrons README](../packages/squadrons/README.md), #573, #626, #738 |
| 1 s | A flagship's wait before receiving again after a failed receive | [flagships/flagship-watch.ts](../packages/squadrons/src/adapters/flagships/flagship-watch.ts) `RETRY_MS` | none recorded |
| 10 | Deliveries per flagship receive | [fleet/rest-fleet-door.ts](../packages/squadrons/src/adapters/fleet/rest-fleet-door.ts) (inline `max: 10`) | [architecture.md](architecture.md) |
| made once | A retire is never made again while the fleet is busy | [fleet/rest-fleet-door.ts](../packages/squadrons/src/adapters/fleet/rest-fleet-door.ts) `isBulk` | [architecture.md](architecture.md), #734 |
| 2 calls | A commission asked again under the same idempotency key when no answer came | [squadron/formation.ts](../packages/squadrons/src/core/squadron/formation.ts) (inline) | none recorded |
| 5 names | Random names tried per ship before commissioning gives up on a name conflict | [squadron/formation.ts](../packages/squadrons/src/core/squadron/formation.ts) `NAME_ATTEMPTS` | none recorded |
| 5 passes | Recovery passes with a refused retire before retiring stops and argo is told once | [squadron/recover-formations.ts](../packages/squadrons/src/core/squadron/recover-formations.ts) `RECOVERY_REFUSAL_LIMIT` | #736, #738, #740 |
| late after 1 interval, silent after 3 | A member that misses its check-in | [squadron/member-health.ts](../packages/squadrons/src/core/squadron/member-health.ts) `SILENT_AFTER_INTERVALS` (late inline) | [squadrons.md](squadrons.md), #86 |
| 1 minute to 24 hours | A template's check-in interval | [catalogue/assemble-catalogue.ts](../packages/squadrons/src/core/catalogue/assemble-catalogue.ts) `CHECK_IN_MAX_MINUTES` | [squadrons.md](squadrons.md) |
| 1 to 20, default 1 | Ships per blueprint role | [catalogue/assemble-catalogue.ts](../packages/squadrons/src/core/catalogue/assemble-catalogue.ts) `COUNT_MAX` | [squadrons.md](squadrons.md) |
| 48 KB | A template's charter, also after its parameters are filled | [catalogue/catalogue.ts](../packages/squadrons/src/core/catalogue/catalogue.ts) `CHARTER_MAX_BYTES` | [0006](decisions/0006-payload-limit.md), [squadrons.md](squadrons.md), #371 |
| 1 KB | One parameter value from the form | [squadron/member-crew-request.ts](../packages/squadrons/src/core/squadron/member-crew-request.ts) `PARAMETER_VALUE_MAX_BYTES` | [squadrons.md](squadrons.md), #371 |
| 50 squadrons | Squadrons that carry the `squadron` label (its 50 values) | `LABEL_VALUES_MAX` in common, used in [network/label-squadrons.ts](../packages/squadrons/src/core/network/label-squadrons.ts) | [0031](decisions/0031-labels.md), [squadrons.md](squadrons.md), #573 |
| 30 s | One GitHub API request | [github/github-repository-reader.ts](../packages/squadrons/src/adapters/github/github-repository-reader.ts) `DEFAULT_TIMEOUT_MS` | none recorded |
| 100 per page | GitHub tags fetched per page | [github/github-repository-reader.ts](../packages/squadrons/src/adapters/github/github-repository-reader.ts) `TAGS_PER_PAGE` | none recorded |
| 300 characters | A failed fetch's stored message | [github/github-repository-reader.ts](../packages/squadrons/src/adapters/github/github-repository-reader.ts) `FETCH_ERROR_MAX_LENGTH` | none recorded |
| 1 to 1024 characters | A template repository's read token | [catalogue/template-repository.ts](../packages/squadrons/src/core/catalogue/template-repository.ts) `TOKEN_MAX_LENGTH` | #161 |
| 10 s (Prisma's), tried again without end | Prisma Migrate's advisory lock at start | [prisma/migrate.ts](../packages/squadrons/src/adapters/prisma/migrate.ts) `LOCK_TIMED_OUT` | none recorded |
| at least 32 characters | `INSTALLATION_TOKEN`, when set | [config.ts](../packages/squadrons/src/config.ts) `INSTALLATION_TOKEN_MIN_LENGTH` | [0021](decisions/0021-squadrons-installation.md) |

## Trierarch

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 1 minute | A session's launch window: a tool call within it, or it is stopped and given back (or counted as a failed start) | [core/reconciler.ts](../packages/trierarch/src/core/reconciler.ts) `LAUNCH_WINDOW_MS` | [trierarch.md](trierarch.md#crewing-a-ship), #382, #397, #473 |
| 10 minutes (coming, not built yet) | The oldest delivery waiting while a session runs, before argo is told the session is waiting on chat | not built yet | #586 |
| 5 s, 30 s, 2 min, then 10 min | The wait before each restart of a session that died | [core/restart-policy.ts](../packages/trierarch/src/core/restart-policy.ts) `RESTART_DELAYS_MS` | [architecture.md](architecture.md), [0026](decisions/0026-trierarch.md) |
| 5 restarts within 60 minutes | The restart budget; past it the crew is crashed and argo told | [core/restart-policy.ts](../packages/trierarch/src/core/restart-policy.ts) `RESTART_BUDGET`, `RESTART_WINDOW_MS` | [0026](decisions/0026-trierarch.md), #397, #469 |
| 5 s | A pass: restarts, wakes, releases and the launch window run at most this often; also the pause after a failure | [cli/run.ts](../packages/trierarch/src/cli/run.ts) `PASS_INTERVAL_MS` | #250 |
| 10 | Deliveries per receive of the trierarch's own ship | [adapters/rest-fleet.ts](../packages/trierarch/src/adapters/rest-fleet.ts) (inline `max: 10`) | [architecture.md](architecture.md) |
| 1 s | Between typing Codex's wake prompt and pressing Enter | [adapters/codex.ts](../packages/trierarch/src/adapters/codex.ts) `CODEX_TYPING_SETTLE_MS` | [architecture.md](architecture.md) |
| 60 s | Claude Code's model probe | [adapters/claude-code-detector.ts](../packages/trierarch/src/adapters/claude-code-detector.ts) `CLAUDE_CODE_PROBE_TIMEOUT_MS` | none recorded |
| 10 s | Claude Code's `--version` and `--help` | [adapters/claude-code-detector.ts](../packages/trierarch/src/adapters/claude-code-detector.ts) `QUICK_TIMEOUT_MS` | none recorded |
| 60 s | Codex's model probe | [adapters/codex-detector.ts](../packages/trierarch/src/adapters/codex-detector.ts) `CODEX_PROBE_TIMEOUT_MS` | none recorded |
| 10 s | Codex's `--version` and `debug models` | [adapters/codex-detector.ts](../packages/trierarch/src/adapters/codex-detector.ts) `QUICK_TIMEOUT_MS` | none recorded |
| 30 s | `codex app-server` answering during trust setup | [adapters/codex-setup.ts](../packages/trierarch/src/adapters/codex-setup.ts) `ANSWER_TIMEOUT_MS` | #581 |
| 3 | Times Claude Code's fullscreen offer counts as seen | [adapters/claude-code-setup.ts](../packages/trierarch/src/adapters/claude-code-setup.ts) `FULLSCREEN_OFFER_SHOWN_MAX` | [trierarch.md](trierarch.md#unattended), #403 |
| at most 30 s, checked each second | Waiting for a new process to write its version after restart, install, add or upgrade | [cli/new-process.ts](../packages/trierarch/src/cli/new-process.ts) `TIMEOUT_MS`, `CHECK_MS` | [architecture.md](architecture.md), #376 |
| 30 checks a second apart | Waiting for the launchd agent to be gone on stop or install | [adapters/service.ts](../packages/trierarch/src/adapters/service.ts) `STOP_CHECKS`, `STOP_CHECK_MS` | none recorded |
| 5 s | systemd restarting the trierarch service (`RestartSec`) | [adapters/service.ts](../packages/trierarch/src/adapters/service.ts) (unit template) | none recorded |
| at least 60 s | A Codex plugin version folder is removed only when every running session started this long after the next version arrived | [adapters/plugin-update.ts](../packages/trierarch/src/adapters/plugin-update.ts) `START_MARGIN_MS` | [trierarch.md](trierarch.md#a-machine-joins), #653 |
| 1 MiB, one rotated file | The macOS log (the journal caps it on Linux) | [adapters/capped-log.ts](../packages/trierarch/src/adapters/capped-log.ts) `LOG_MAX_BYTES` | [trierarch.md](trierarch.md#a-machine-joins) |
| 60 s | A rotation lock older than this is stale | [adapters/capped-log.ts](../packages/trierarch/src/adapters/capped-log.ts) `STALE_LOCK_MS` | none recorded |
| 50 lines; followed every 500 ms on macOS | `logs` | [cli/main.ts](../packages/trierarch/src/cli/main.ts) `DEFAULT_LINES`, `FOLLOW_INTERVAL_MS` | none recorded |
| 5 lines | What a release discards that the report to argo names; the trierarch's log holds them all | [core/argo-reports.ts](../packages/trierarch/src/core/argo-reports.ts) `DISCARDED_NAMED_MAX` | [trierarch.md](trierarch.md#lifecycles), #450, #849 |
| 200 lines; pane 200 by 50 | The screen read from a session, host and container | [adapters/tmux.ts](../packages/trierarch/src/adapters/tmux.ts), [adapters/container.ts](../packages/trierarch/src/adapters/container.ts) `SCREEN_LINES` | [0039](decisions/0039-container-sessions.md) |
| 4 ships, 2 running (written by `init`, whole numbers of at least 1) | The machine's caps, set in its configuration | [adapters/files.ts](../packages/trierarch/src/adapters/files.ts) `initialConfiguration`; [common trierarch/configuration.ts](../packages/common/src/trierarch/configuration.ts) | [0026](decisions/0026-trierarch.md), [trierarch.md](trierarch.md#what-a-trierarch-reports) |
| per container, from the configuration's `runtime.memory` and `runtime.cpus` | A container session's memory and CPUs | [common trierarch/configuration.ts](../packages/common/src/trierarch/configuration.ts); [adapters/runtime-adapters.ts](../packages/trierarch/src/adapters/runtime-adapters.ts); [adapters/container.ts](../packages/trierarch/src/adapters/container.ts) `ContainerRuntimeOptions` | [0039](decisions/0039-container-sessions.md) |
| 4096 processes and threads per container | A container session's processes, so a runaway fork cannot starve the machine | [adapters/container.ts](../packages/trierarch/src/adapters/container.ts) `PIDS_LIMIT` | [0039](decisions/0039-container-sessions.md) |
| 0.23.0 | The first release with a plugin, for `upgrade` | [cli/upgrade.ts](../packages/trierarch/src/cli/upgrade.ts) `FIRST_PLUGIN_TAG` | [trierarch.md](trierarch.md#a-machine-joins), #652 |

## Trierarch plugin

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 300 s (default, `TRIERARCH_SILENT_AFTER_SECONDS`) | A machine whose trierarch has no last seen this long is silent | [config.ts](../packages/trierarch-plugin/src/config.ts) `DEFAULT_SILENT_AFTER_SECONDS`; [app.ts](../packages/trierarch-plugin/src/app.ts) `DEFAULT_SILENT_AFTER_MS` | [0030](decisions/0030-trierarch-plugin.md), [trierarch.md](trierarch.md#assignment) |
| 10 s (default, `TRIERARCH_PASS_INTERVAL_SECONDS`) | Between assignment passes per fleet; a pass still running skips the next | [config.ts](../packages/trierarch-plugin/src/config.ts) `DEFAULT_PASS_INTERVAL_SECONDS` | [trierarch plugin README](../packages/trierarch-plugin/README.md) |
| 10 s (Prisma's), tried again without end | Prisma Migrate's advisory lock at start | [prisma/migrate.ts](../packages/trierarch-plugin/src/adapters/prisma/migrate.ts) `LOCK_TIMED_OUT` | none recorded |
| at least 32 characters | `INSTALLATION_TOKEN`, when set | [config.ts](../packages/trierarch-plugin/src/config.ts) `INSTALLATION_TOKEN_MIN_LENGTH` | [0020](decisions/0020-installation.md) |

## Networking plugin

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| keep-latest after 300 s | What a fleet's networking plugin declares until argo sets it | [network/declaration.ts](../packages/networking-plugin/src/core/network/declaration.ts) `DEFAULT_DECLARATION` | [0036](decisions/0036-networking-plugin-package.md), #260 |
| 10 s (default, `SUPPLY_RETRY_SECONDS`) | Supplying again what the fleet refused; a retry still running skips the next | [config.ts](../packages/networking-plugin/src/config.ts) `DEFAULT_SUPPLY_RETRY_SECONDS` | [0036](decisions/0036-networking-plugin-package.md), #260 |
| 5 s | Rescanning for fleets connected or switched on | [app.ts](../packages/networking-plugin/src/app.ts) `DEFAULT_RESCAN_MS` | none recorded |
| 1 s | Calling again after a fleet call is refused or fails | [fleet/fleet-watch.ts](../packages/networking-plugin/src/adapters/fleet/fleet-watch.ts) `RETRY_MS` | [0035](decisions/0035-networking-plugin.md) |
| 25 s (0 on the first call) | One `fleet.follow` wait for declared rules | [network/follow-declarations.ts](../packages/networking-plugin/src/core/network/follow-declarations.ts) `WAIT_SECONDS` | [0037](decisions/0037-declared-network-rules.md) |
| 10 | Deliveries per receive | [fleet/rest-fleet-door.ts](../packages/networking-plugin/src/adapters/fleet/rest-fleet-door.ts) `RECEIVE_MAX` | [architecture.md](architecture.md) |
| 10 s (Prisma's), tried again without end | Prisma Migrate's advisory lock at start | [prisma/migrate.ts](../packages/networking-plugin/src/adapters/prisma/migrate.ts) `LOCK_TIMED_OUT` | none recorded |
| at least 32 characters | `INSTALLATION_TOKEN`, when set | [config.ts](../packages/networking-plugin/src/config.ts) `INSTALLATION_TOKEN_MIN_LENGTH` | [0020](decisions/0020-installation.md) |

## The aeolus plugin

Each setting below is an environment variable the script reads, with the default shown.

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 25 s | One inbox wait of the watcher | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) `AEOLUS_WAIT_SECONDS` | [blueprint.md](blueprint.md), [plugin README](../plugins/aeolus/README.md) |
| 5 s | Between inbox checks while deliveries wait | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) `AEOLUS_POLL_SECONDS` | [plugin README](../plugins/aeolus/README.md) |
| 2 s, doubling, at most 60 s | The watcher calling again after a failed call | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) `AEOLUS_RETRY_SECONDS`, `AEOLUS_RETRY_MAX_SECONDS` | none recorded |
| 6900 s (1 h 55 min) | The watcher stops ("for almost 2 hours", exit 6); no limit under the Codex wake bridge | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) `AEOLUS_MAX_SECONDS`; [aeolus-codex-wake.sh](../plugins/aeolus/scripts/aeolus-codex-wake.sh) | [plugin README](../plugins/aeolus/README.md) |
| the inbox wait plus 15 s | The watcher's inbox call (`curl --max-time`) | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) (inline) | none recorded |
| 60 s | Every `aeolus-fleet.sh` call (`curl --max-time`) | [aeolus-fleet.sh](../plugins/aeolus/scripts/aeolus-fleet.sh) `AEOLUS_CALL_MAX_SECONDS` | none recorded |
| 3 s | Each ack a hook makes to confirm a handed message, so its busy retries end inside a hook's time | [aeolus-lib.sh](../plugins/aeolus/scripts/aeolus-lib.sh) `AEOLUS_CONFIRM_SECONDS` | #756 (3.9) |
| the inbox wait plus 15 s | The watcher's receive of the message it hands over (`curl --max-time`) | [aeolus-wait.sh](../plugins/aeolus/scripts/aeolus-wait.sh) (inline) | #756 |
| 10,000 bytes | The most a hook puts into a turn: Claude Code's cap on hook context. A longer message goes in as its first part and the path of a file that holds the payload | [aeolus-lib.sh](../plugins/aeolus/scripts/aeolus-lib.sh) `AEOLUS_TURN_TEXT_MAX_BYTES` | #756 (D2) |
| 8000 bytes | That first part of a longer payload | [aeolus-lib.sh](../plugins/aeolus/scripts/aeolus-lib.sh) `AEOLUS_FIRST_PART_BYTES` | #756 (D2) |
| 1, 2, 4, 8 s, each drawn between half and all of it | Calling again while the fleet answers busy, a copy of `FLEET_BUSY_WAITS_MS` | [aeolus-fleet.sh](../plugins/aeolus/scripts/aeolus-fleet.sh) `AEOLUS_BUSY_WAITS` | [architecture.md](architecture.md), #734 |
| 15 s | The inbox script's call (`curl --max-time`) | [aeolus-inbox.sh](../plugins/aeolus/scripts/aeolus-inbox.sh) (inline) | none recorded |
| 1 MiB, one rotated file | The plugin's log | [aeolus-lib.sh](../plugins/aeolus/scripts/aeolus-lib.sh) `AEOLUS_LOG_MAX_BYTES` | [plugin README](../plugins/aeolus/README.md), [trierarch.md](trierarch.md#a-machine-joins) |
| 1 minute | A log rotation lock older than this is stale | [aeolus-lib.sh](../plugins/aeolus/scripts/aeolus-lib.sh) (inline `-mmin +1`) | none recorded |
| 6000 characters | A prefilled issue link's encoded body (GitHub refuses past about 8 KB) | [aeolus-issue.sh](../plugins/aeolus/scripts/aeolus-issue.sh) `LINK_BODY_MAX` | none recorded |
