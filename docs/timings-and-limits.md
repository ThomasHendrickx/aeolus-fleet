# Timings and limits

Every fixed timing and limit of core's release train, by package, for debugging. This page holds no rules of its own: each line points to the constant that sets it and the decision, issue or doc that says why. When a value here and its source disagree, the source wins; fix this page.

A default that configuration may change names its setting. Unit helpers (`SECOND_MS`, `MINUTES_PER_HOUR` and the like) and the lengths of random id suffixes are left out.

## Common: the limits every package shares

Defined in `@aeolus-fleet/common`, checked by core on every call and by the clients before they call.

### Sizes

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 64 KB (`64 * 1024` bytes, UTF-8) | A message payload; also a `CHECK` on `messages.payload` | [rules/payload.ts](../packages/common/src/rules/payload.ts) `PAYLOAD_MAX_BYTES`; [init migration](../packages/core/src/adapters/prisma/migrations/20260929124818_init/migration.sql) `messages_payload_max_64kb` | [0006](decisions/0006-payload-limit.md) |
| 16 KB | A report's details, checked on the result of a merge patch | [schemas/report.ts](../packages/common/src/schemas/report.ts) `REPORT_DETAILS_MAX_BYTES` | [0028](decisions/0028-report-details.md) |
| 16 KB | A crew request's settings | [schemas/crew-request.ts](../packages/common/src/schemas/crew-request.ts) `CREW_REQUEST_SETTINGS_MAX_BYTES` | [0029](decisions/0029-crew-request.md) |
| 8192 bytes | A crew's first prompt, after squadrons fills its parameters | [trierarch/crew-settings.ts](../packages/common/src/trierarch/crew-settings.ts) `FIRST_PROMPT_MAX_BYTES` | [0027](decisions/0027-crew-settings.md), [trierarch.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/trierarch.md#the-crew-request), #371 |

### Lengths

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 48 characters | A ship name or type; squadron ids and template handles too | [rules/ship-handle.ts](../packages/common/src/rules/ship-handle.ts) `SHIP_HANDLE_MAX_LENGTH` | [blueprint.md](blueprint.md) |
| 63 characters (a-z, 0-9, -) | A label key or value; machine labels too | [rules/label-handle.ts](../packages/common/src/rules/label-handle.ts) `LABEL_HANDLE_MAX_LENGTH` | [0031](decisions/0031-labels.md) |
| 200 characters, one line | A report note | [schemas/report.ts](../packages/common/src/schemas/report.ts) `REPORT_NOTE_MAX_LENGTH` | [blueprint.md](blueprint.md) |
| 200 characters, one line | A crew request's reason and a give-back's reason (the trierarch and the trierarch plugin cut theirs to it) | [schemas/crew-request.ts](../packages/common/src/schemas/crew-request.ts) `CREW_REQUEST_REASON_MAX_LENGTH` | [0029](decisions/0029-crew-request.md), #382 |
| 1 to 32 characters (a-z, 0-9, -, starting with a letter) | Each part of a scope, `<namespace>:<action>` | [fleet/index.ts](../packages/common/src/fleet/index.ts) `SCOPE_NAMESPACE_PATTERN`, `SCOPE_NAME_PATTERN` | [0046](decisions/0046-scope-catalogue.md) |
| 200 characters, one line | A declared scope's description | [fleet/index.ts](../packages/common/src/fleet/index.ts) `SCOPE_DESCRIPTION_MAX_LENGTH` | [0046](decisions/0046-scope-catalogue.md) |
| 500 characters | A ship note | [schemas/fleet.ts](../packages/common/src/schemas/fleet.ts) `SHIP_NOTE_MAX_LENGTH` | none recorded |
| 256 characters | A content type | [schemas/message.ts](../packages/common/src/schemas/message.ts) `CONTENT_TYPE_MAX_LENGTH` | none recorded |
| 100 characters | A model id on a send | [schemas/message.ts](../packages/common/src/schemas/message.ts) `MODEL_MAX_LENGTH` | [0018](decisions/0018-model-and-harness.md) |
| 50 characters | A harness | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `HARNESS_MAX_LENGTH` | [0018](decisions/0018-model-and-harness.md) |
| 100 characters | An OTHER location's description | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `LOCATION_DESCRIPTION_MAX_LENGTH` | none recorded |
| 256 characters | A ship secret passed to `register` | [schemas/ship.ts](../packages/common/src/schemas/ship.ts) `SHIP_SECRET_MAX_LENGTH` | none recorded |
| 256 characters | An idempotency key | [schemas/idempotency-key.ts](../packages/common/src/schemas/idempotency-key.ts) `IDEMPOTENCY_KEY_MAX_LENGTH` | none recorded |
| 254 characters | An operator email | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_EMAIL_MAX_LENGTH` | none recorded |
| 1024 characters | An operator password | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_PASSWORD_MAX_LENGTH` | [0016](decisions/0016-no-policy.md) |
| 12 characters | A new operator password, at least: Settings and `operator:reset-password` (sign-in checks no minimum) | [rules/sign-in.ts](../packages/common/src/rules/sign-in.ts) `OPERATOR_PASSWORD_MIN_LENGTH` | #824 |
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
| 20 | Scopes one namespace declares | [fleet/index.ts](../packages/common/src/fleet/index.ts) `NAMESPACE_SCOPES_MAX` | [0046](decisions/0046-scope-catalogue.md) |
| 100 | Pending clear requests per trierarch | [schemas/clear-request.ts](../packages/common/src/schemas/clear-request.ts) `CLEAR_REQUESTS_PER_TRIERARCH_MAX` | [0032](decisions/0032-clear-request.md) |
| 5 | Notices at once | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `MAX_NOTICES` | [0023](decisions/0023-notices.md) |
| 3 | Links per notice | [schemas/notice.ts](../packages/common/src/schemas/notice.ts) `MAX_NOTICE_LINKS` | [0023](decisions/0023-notices.md) |
| 1 to 10 | Guide steps | [schemas/guide.ts](../packages/common/src/schemas/guide.ts) `MAX_GUIDE_STEPS` | [0024](decisions/0024-guide.md) |

### Timings

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 0 to 25 s | The wait an inbox check may ask for | [schemas/delivery.ts](../packages/common/src/schemas/delivery.ts) `INBOX_WAIT_MAX_SECONDS` | [blueprint.md](blueprint.md) |
| 0 to 25 s | The wait a `fleet.follow` may ask for | [schemas/follow.ts](../packages/common/src/schemas/follow.ts) `FOLLOW_WAIT_MAX_SECONDS` | none recorded |
| 1, 2, 4, 8 s, each drawn between half and all of it | The waits before a fleet client calls again while the fleet answers busy: 5 calls in all. Squadrons, the trierarch and the trierarch plugin use it; the aeolus plugin keeps a copy (below) | [fleet/index.ts](../packages/common/src/fleet/index.ts) `FLEET_BUSY_WAITS_MS`; [fleet/busy-wait.ts](../packages/common/src/fleet/busy-wait.ts) `busyWaitMs` | [architecture.md](architecture.md), #734 |

## Core

### Messaging

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 25 s | How long a receive waits on an empty inbox before it answers empty (long poll) | [messaging/receive-deliveries.ts](../packages/core/src/domain/messaging/receive-deliveries.ts) `RECEIVE_WAIT_MS` | [architecture.md](architecture.md), [blueprint.md](blueprint.md) |
| 5th attempt | A delivery received this often without an ack is refused, handed to no one: it becomes undeliverable and is stuck on Health | [messaging/delivery.ts](../packages/core/src/domain/messaging/delivery.ts) `UNDELIVERABLE_AT_ATTEMPT` | [blueprint.md](blueprint.md), [architecture.md](architecture.md) |
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
| 15 minutes | A sign-in link from `fleet:init` or `aeolus-core sign-in` stays valid | [identity/sign-in-ticket.ts](../packages/core/src/domain/identity/sign-in-ticket.ts) `SIGN_IN_LINK_VALID_MS` | [0012](decisions/0012-operator-is-a-ship.md) |
| 10 minutes, and 30 seconds of allowance | An account token's life: refused 30 s after its end, refused when it lives longer or was issued more than 30 s ahead | [identity/authenticate-account.ts](../packages/core/src/domain/identity/authenticate-account.ts) `ACCOUNT_TOKEN_LIFE_MS`, `ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS` | [0058](decisions/0058-pagasae-core-link.md) |
| 60 s | How long core holds pagasae's keys before it fetches them again | [crypto/account-token-signatures.ts](../packages/core/src/adapters/crypto/account-token-signatures.ts) `KEYS_FRESH_FOR_MS` | [0058](decisions/0058-pagasae-core-link.md) |
| 5 s | Fetching pagasae's key set, before core goes on with the keys it holds | [app.ts](../packages/core/src/app.ts) `KEY_SET_FETCH_TIMEOUT_MS` | none recorded |
| 11 minutes | How long a cut-off account is kept: past the longest token issued before it | [identity/cut-off-account.ts](../packages/core/src/domain/identity/cut-off-account.ts) `CUT_OFF_KEPT_MS` | [0058](decisions/0058-pagasae-core-link.md) |
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
| under 1 minute, then up to 15 minutes, then long ago | Last seen: fresh, a while, long ago | [features/fleet/services/last-seen.ts](../packages/console/features/fleet/services/last-seen.ts) `MINUTE_MS`, `A_WHILE_MS` | [design/conventions.md](design/conventions.md) |
| late after 1 interval, silent after 3 | A squadron member's check-in, as squadrons judges it (below) | [lib/squadrons-view.ts](../packages/console/lib/squadrons-view.ts) `LATE_AFTER_INTERVALS`, `SILENT_AFTER_INTERVALS` | [squadrons.md](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/squadrons.md) |
| from 15 labels | A ship page shows "n of 20" | [lib/labels.ts](../packages/console/lib/labels.ts) `SHOWN_COUNT_FROM` | [0031](decisions/0031-labels.md) |
| 2 label chips, then "+n" | Labels on a ship | [components/molecules/ship-labels.tsx](../packages/console/components/molecules/ship-labels.tsx) `SHOWN`; [features/ship/organisms/ship-labels-edit.tsx](../packages/console/features/ship/organisms/ship-labels-edit.tsx) `SHOWN` | [design/README.md](design/README.md) |
| 22 characters | Labels beside a name in the fleet table, then "+n" | [features/fleet/ui/organisms/fleet-table.tsx](../packages/console/features/fleet/ui/organisms/fleet-table.tsx) `ROW_LABELS_WIDTH` | #102 |
| 8 ships | Ships the command palette lists before anything is typed | [features/commands/services/command-palette.ts](../packages/console/features/commands/services/command-palette.ts) `SHIPS_BEFORE_QUERY` | none recorded |
| 1.5 s | A copy button shows its check | [components/atoms/copy-button.tsx](../packages/console/components/atoms/copy-button.tsx) `COPIED_FOR_MS` | [design/README.md](design/README.md) |
| 500 ms | A tooltip opens after hovering | [components/atoms/tooltip.tsx](../packages/console/components/atoms/tooltip.tsx) `HOVER_DELAY_MS` | [design/README.md](design/README.md) |
| 5 s; errors until dismissed | A toast closes by itself | [components/atoms/toast.tsx](../packages/console/components/atoms/toast.tsx) `SUCCESS_DURATION_MS` | none recorded |

## Other release trains

Each holds its own timings and limits in its repository (decision 0049):

- squadrons: [aeolus-fleet-squadrons](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/timings-and-limits.md)
- the trierarch and the aeolus plugin: [aeolus-fleet-trierarch](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/timings-and-limits.md)
- the trierarch plugin: [aeolus-fleet-trierarch-plugin](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/blob/main/docs/timings-and-limits.md)
