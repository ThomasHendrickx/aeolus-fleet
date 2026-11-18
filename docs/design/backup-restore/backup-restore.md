# Backup and restore

## Purpose

Let a self-hoster recover a fleet after losing its database, knowing what can be recovered, what may repeat and how crews resume. The owner approved picks A to E on 18 Nov 2026 (card 761d6cca).

## Lessons to check against

- [Blueprint](../../blueprint.md): a send answers OK only after durable storage; no message is ever lost, delivery resumes automatically, and the operator is not the fail-safe. Restoring an older database can discard already accepted messages; a process restart cannot.
- [Decisions index](../../decisions/README.md): [0001](../../decisions/0001-ack-on-receipt.md) makes ack receipt, not execution; [0003](../../decisions/0003-postgres-as-broker.md) commits messages and deliveries in Postgres before OK; [0010](../../decisions/0010-leases-without-heartbeats.md) keeps leases until released and returns in-flight deliveries; [0015](../../decisions/0015-ship-identity-per-conversation.md) binds crew tokens to leases. [0066](../../decisions/0066-retention.md) prunes finished history, not open deliveries. Backup retention is a separate choice.
- [Current server guide, section 5](../../guide/run-the-server.md#5-back-up-and-restore): nightly dumps, before-upgrade backups, 14-day retention, optional point-in-time recovery (PITR), encrypted off-server storage and settings kept separately. It describes lost post-backup messages, repeated deliveries, `fleet:restored` ending non-argo leases and returning in-flight deliveries, and clients treating unknown crew tokens as ended leases. It requires a consistent recovery point and explains that duplicate suppression depends on receiver state surviving the restore.
- Infra today: `scripts/backup.sh` encrypts and uploads sequential dumps, checks their archive listings, deletes dumps older than 14 days and retains 14 WAL-G base backups with WAL. `scripts/restore.sh` replaces one database and restarts its services; `scripts/restore-pitr.sh` can recover the whole cluster to one moment, keep a scratch copy or replace production. The recovery procedure requires `fleet:restored` and a restore rehearsal in addition to these scripts and archive checks.

## Approved choices

### A. What schedule and retention should self-hosters be offered?

1. Recommend nightly encrypted off-server backups, plus before upgrades; keep sets 14 days. Recommend continuous WAL archiving and base backups for a smaller recovery gap, and a periodic restore rehearsal. Leave the actual schedule configurable.
2. Require PITR for every installation, with a fixed retention.

**Pick 1:** Nightly dumps risk up to a day's accepted messages; PITR reduces that gap only to the last recoverable WAL, not necessarily zero. Fourteen base backups are not necessarily fourteen days if runs fail.

### B. What happens to leases and a session holding an unknown crew token?

1. Settle recovery before serving: end all non-argo leases, return in-flight deliveries to pending, and have clients treat `UNKNOWN_CREW_TOKEN` like `LEASE_ENDED`, discard local identity and stop using that token. Trierarchs resume through restored crew requests; hand crews need new prompts. Never accept or reconstruct an unknown token.
2. Preserve restored leases and ask the self-hoster to identify and release stale crews individually.

**Pick 1:** A crew request or ship created after the recovery point is absent and cannot resume automatically; the self-hoster must recreate it. The argo exception remains; unknown tokens are not authenticated.

### C. What happens to deliveries acknowledged after the recovery point?

1. Redeliver any restored delivery whose acknowledgement is absent, under its existing delivery id. Receivers use that id for deduplication where their own durable state permits it; repeated receipt or effects remain possible.
2. Suppress deliveries presumed received before the failure.

**Pick 1:** An absent acknowledgement cannot prove receipt. Recovery cannot promise exactly-once execution or deduplication when a receiver's records also rolled back.

### D. What happens to messages sent after the recovery point?

1. Explicitly scope the durability promise: ordinary failures preserve accepted messages, but restoring older data loses messages beyond the recoverable point, even if send answered OK. The blueprint states this scope.
2. Keep the promise unconditional and require a separately durable message record with automatic replay across database rollback before calling restore supported.

**Pick 1:** PITR does not eliminate loss. The restored fleet cannot detect or notify individual missing messages from records it no longer has.

Owner’s note: "The promise is when the system. works, backups on self hosted is their responsibility and is something we cant solve for them."

### E. What should the self-hoster do after a restore?

1. Follow one recovery procedure: keep writers stopped; recover every participating database to a consistent point (quiesce writes for dump sets, or use cluster PITR); restore settings and required sealing keys; run `fleet:restored` before serving; start and check health and versions. Confirm crews resume, reconnect unknown plugin identities and recreate missing ships or requests. Record the recovery point and warn users about possible loss and repeated receipt before resuming work.
2. Restore each database independently and restart immediately, leaving reconciliation to the self-hoster.

**Pick 1:** Shared ids and credentials require coordinated recovery. Preserve the damaged data for investigation; inspect surviving sender or external records for missing work. The guide describes the full procedure.
