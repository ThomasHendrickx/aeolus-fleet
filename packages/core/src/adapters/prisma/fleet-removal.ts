import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRemoval } from '../../domain/registry/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

/** Tables whose rows grow with the fleet's history and go by their fleet id, children first; a batch takes the first not yet empty. */
const BY_FLEET = ['health_snapshot_deliveries', 'health_snapshots'] as const;
const THEN_BY_FLEET = ['overdue_deliveries', 'exchanges', 'pruned_exchanges'] as const;

/** The fleet's other records, children first, after its history: each in batches too, so no step grows with the fleet (the fleet row and its request go last). */
const RECORDS = [
  'commission_approvals',
  'schedules',
  'data_keys',
  'fleet_feature_flags',
  'meeting_mic_requests',
  'meeting_participants',
  'meetings',
  'message_days',
  'notice_dismissals',
  'guide_progress',
  'account_notice_dismissals',
  'account_guide_progress',
  'console_sessions',
  'sign_in_tickets',
  'credentials',
  'crew_request_give_backs',
  'crew_requests',
  'worktree_clear_requests',
  'network_settings',
  'network_rules_drafts',
  'reach_refusals',
  'declared_network_rules',
  'installation_declared_network_rules',
  'scope_namespaces',
  'defined_scopes',
  'verified_facts',
  'alerts',
  'ship_expectations',
  'ship_labels',
  'label_values',
  'labels',
  'leases',
  'ships',
  'operators',
] as const;

/**
 * The removal of a fleet marked deleted, on Postgres (decision 0020). A
 * batch takes a transaction-level advisory lock on the fleet's removal with
 * try, so a second server skips the fleet, and removes at most `limit` rows
 * of the first kind of history that still has rows, children first, and a
 * records batch then the same of its schedules, leases, ships and every other
 * record, so no step grows with the fleet: every
 * foreign key restricts, and a message may answer or resend another of the
 * fleet, so messages go newest first, after the schedules stop naming them.
 * The last step removes only the fleet row and the request that created it.
 * Each statement reads its rows through an index in order, so a batch costs
 * the batch, not the fleet's history. The fleet's events go under the
 * transaction-local setting `aeolus.deleting_fleet`.
 */
export function createPrismaFleetRemoval(db: Db): FleetRemoval {
  const removeByFleet = async (table: string, { fleetId, limit }: { fleetId: FleetId; limit: number }): Promise<number> =>
    db.$executeRaw`
      DELETE FROM ${Prisma.raw(table)}
      WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${Prisma.raw(table)} WHERE fleet_id = ${fleetId} LIMIT ${limit}))`;

  return {
    tryLock: async (fleetId) => {
      const [row] = await db.$queryRaw<{ isLocked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${fleetId}), hashtext('fleet-removal')) AS "isLocked"`;
      return row?.isLocked === true;
    },
    removeHistoryBatch: async (fleetId, limit) => {
      // Events are append-only; naming the fleet for this transaction alone lets
      // its events go with it, and no other fleet's (decision 0020).
      await db.$queryRaw`SELECT set_config('aeolus.deleting_fleet', ${fleetId}, true)`;
      for (const table of BY_FLEET) {
        if ((await removeByFleet(table, { fleetId, limit })) > 0) {
          return 'more';
        }
      }
      if ((await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId} AND id IN (SELECT id FROM events WHERE fleet_id = ${fleetId} ORDER BY seq LIMIT ${limit})`) > 0) {
        return 'more';
      }
      for (const table of THEN_BY_FLEET) {
        if ((await removeByFleet(table, { fleetId, limit })) > 0) {
          return 'more';
        }
      }
      if ((await db.$executeRaw`DELETE FROM deliveries WHERE fleet_id = ${fleetId} AND id IN (SELECT id FROM deliveries WHERE fleet_id = ${fleetId} ORDER BY id LIMIT ${limit})`) > 0) {
        return 'more';
      }
      // A schedule names the messages it replies to and sent, so it lets go of them, and of its last outcome, which the table's check ties to the message, before they go (a fleet has few schedules).
      if ((await db.$executeRaw`UPDATE schedules SET in_reply_to_message_id = NULL, last_message_id = NULL, last_outcome_kind = NULL, last_refusal_code = NULL, last_send_time = NULL, last_outcome_at = NULL WHERE fleet_id = ${fleetId} AND (in_reply_to_message_id IS NOT NULL OR last_message_id IS NOT NULL)`) > 0) {
        return 'more';
      }
      const removed = await db.$executeRaw`
        DELETE FROM messages WHERE fleet_id = ${fleetId}
          AND id IN (SELECT id FROM messages WHERE fleet_id = ${fleetId} ORDER BY created_at DESC, id DESC LIMIT ${limit})`;
      return removed > 0 ? 'more' : 'empty';
    },
    removeRecordsBatch: async (fleetId, limit) => {
      for (const table of RECORDS) {
        if ((await removeByFleet(table, { fleetId, limit })) > 0) {
          return 'more';
        }
      }
      return 'empty';
    },
    removeRest: async (fleetId) => {
      // The batches left nothing but the fleet row and the request that created it; a row a pass of the fleet wrote since fails the foreign keys, and the next pass batches it away.
      await db.$executeRaw`DELETE FROM installation_requests WHERE fleet_id = ${fleetId}`;
      await db.$executeRaw`DELETE FROM fleets WHERE id = ${fleetId}`;
    },
  };
}
