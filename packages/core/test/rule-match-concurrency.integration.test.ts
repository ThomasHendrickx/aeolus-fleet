import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prismaPoolOf } from '../src/adapters/prisma/client.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { aMatchedFleet, expectRuleMatchesKept } from './support/rule-match-postgres.js';

// Proof step 2 of rule-matches.md: concurrent rule and label writers keep the
// matches a fresh computation, in both orders, without deadlock, and a read
// sees a writer's change and its matches together or not at all.

const REPEATS = 15;
const DEADLOCK = '40P01';

let core: PostgresCore;
beforeAll(async () => {
  core = await createPostgresCore();
});
afterAll(async () => {
  await core.close();
});

/** Holds the fleet's settings lock exclusively on its own connection, so writers queue behind it in a chosen order. */
async function heldSettings(fleetId: FleetId): Promise<{ release(): Promise<void> }> {
  const connection: PoolClient = await prismaPoolOf(core.prisma).pool.connect();
  await connection.query('BEGIN');
  await connection.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('network-settings'))", [fleetId]);
  return {
    release: async () => {
      await connection.query('COMMIT');
      connection.release();
    },
  };
}

async function waitingOnSettings(fleetId: FleetId, count: number): Promise<void> {
  await expect.poll(async () => {
    const rows = await core.prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted AND classid = hashtext(${fleetId})::oid AND objid = hashtext('network-settings')::oid`;
    return rows[0]?.waiting;
  }, { timeout: 10_000 }).toBe(count);
}

/** Starts the writers one after another, each queued on the held settings lock before the next starts, then lets them run. */
async function inQueueOrder(fleetId: FleetId, writers: readonly (() => Promise<unknown>)[]): Promise<unknown[]> {
  const held = await heldSettings(fleetId);
  const pending: Promise<unknown>[] = [];
  try {
    for (const [index, writer] of writers.entries()) {
      pending.push(writer());
      await waitingOnSettings(fleetId, index + 1);
    }
  } finally {
    await held.release();
  }
  return Promise.all(pending);
}

async function discoveredBy(fleet: Awaited<ReturnType<typeof aMatchedFleet>>): Promise<ShipId[]> {
  return unwrap(await fleet.reads.discoveryPage(fleet.person.crew, {})).rows.map(({ shipId }) => shipId).sort();
}

describe('rule matches under concurrent writers', () => {
  it.each(['assign first', 'declare first'] as const)('stay a fresh computation when a declaration and an assignment of its label race, %s', async (order) => {
    // Given a ship the declarer commissioned, about to get its value from the declarer, who holds no labels:any
    // and so takes no reach check's settings lock, while the declarer replaces its rules.
    const fleet = await aMatchedFleet(core);
    const target = unwrap(await core.useCases.commissionShip(fleet.declarer, { idempotencyKey: newKey(), name: 'target', type: 'builder' })).shipId;
    const assign = () => core.useCases.assignLabel(fleet.declarer, { shipId: target, valueId: fleet.blue }).then(unwrap);
    const declare = () => core.useCases.declareNetworkRules(fleet.declarer, { rules: [{ verb: 'send', from: [], to: [fleet.blue] }] }).then(unwrap);

    // When both queue on the settings lock in that order.
    await inQueueOrder(fleet.fleetId, order === 'assign first' ? [assign, declare] : [declare, assign]);

    // Then the matches are the authoritative tables' own, and the person ship discovers the target.
    await expectRuleMatchesKept(core, fleet.fleetId);
    expect(await discoveredBy(fleet)).toContain(target);
  });

  it.each(['assign first', 'apply first'] as const)('stay a fresh computation when applying own rules and an assignment race, %s', async (order) => {
    // Given a ship about to get a value while the fleet applies a rule on it.
    const fleet = await aMatchedFleet(core);
    const target = await fleet.ship('target');
    const saved = unwrap(await core.useCases.saveNetworkRulesDraft(fleet.argo, { rules: [{ verb: 'send', from: [], to: [fleet.silver] }, ...fleet.ownRules] }));
    const assign = () => core.useCases.assignLabel(fleet.argo, { shipId: target, valueId: fleet.silver }).then(unwrap);
    const apply = () => core.useCases.applyNetworkRules(fleet.argo, { version: saved.savedAgainstVersion }).then(unwrap);

    // When both queue on the settings lock in that order.
    await inQueueOrder(fleet.fleetId, order === 'assign first' ? [assign, apply] : [apply, assign]);

    // Then the matches are the authoritative tables' own, and the person ship discovers the target.
    await expectRuleMatchesKept(core, fleet.fleetId);
    expect(await discoveredBy(fleet)).toContain(target);
  });

  it.each(['set owner first', 'apply first'] as const)('stay a fresh computation when setting an owner and applying own rules race, %s', async (order) => {
    // Given a ship about to be owned by the person ship while the fleet applies an owner rule.
    const fleet = await aMatchedFleet(core);
    const target = await fleet.ship('target');
    const saved = unwrap(await core.useCases.saveNetworkRulesDraft(fleet.argo, { rules: [{ verb: 'read', from: [], to: [{ owner: fleet.person.shipId }] }, ...fleet.ownRules] }));
    const setOwner = () => core.useCases.setOwner(fleet.argo, { shipId: target, ownerShipId: fleet.person.shipId }).then(unwrap);
    const apply = () => core.useCases.applyNetworkRules(fleet.argo, { version: saved.savedAgainstVersion }).then(unwrap);

    // When both queue on the settings lock in that order.
    await inQueueOrder(fleet.fleetId, order === 'set owner first' ? [setOwner, apply] : [apply, setOwner]);

    // Then the matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation when a declarer retires while its label is assigned, in either order, without deadlock', async () => {
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      // Given a declarer whose value is about to be assigned while it retires.
      const fleet = await aMatchedFleet(core);
      const target = await fleet.ship('target');

      // When both run at once.
      const [assigned, retired] = await Promise.all([
        core.useCases.assignLabel(fleet.argo, { shipId: target, valueId: fleet.red }),
        core.useCases.retireShip(fleet.argo, { shipId: fleet.declarerShipId }),
      ]);

      // Then the retire succeeds, the assignment succeeds or finds the value gone, and the matches are fresh.
      expect(retired.isOk).toBe(true);
      expect(assigned.isOk || assigned.error.kind === 'LABEL_VALUE_NOT_FOUND').toBe(true);
      await expectRuleMatchesKept(core, fleet.fleetId);
    }
  }, 120_000);

  it('never deadlock a send to a ship against its retirement or a declaration', async () => {
    const failures: unknown[] = [];
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      // Given sends to a carrier while it retires and the declarer replaces its rules.
      const fleet = await aMatchedFleet(core);
      const send = () => core.useCases.sendMessage(fleet.argo, { selector: { kind: 'ship', shipId: fleet.first }, payload: 'hello', contentType: 'text/plain', idempotencyKey: newKey() });

      // When they all run at once.
      const settled = await Promise.allSettled([
        send(),
        core.useCases.retireShip(fleet.argo, { shipId: fleet.first }),
        send(),
        core.useCases.declareNetworkRules(fleet.declarer, { rules: [{ verb: 'send', from: [], to: [fleet.blue] }] }),
        send(),
      ]);

      // Then nothing deadlocks and the matches are fresh.
      failures.push(...settled.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : [])));
      await expectRuleMatchesKept(core, fleet.fleetId);
    }
    expect(failures.filter((failure) => JSON.stringify(failure).includes(DEADLOCK))).toEqual([]);
    expect(failures).toEqual([]);
  }, 120_000);

  it('let a read see a declaration and its matches together or not at all', async () => {
    // Given a declaration about to grant discovery of a carrier, and the discovery before it.
    const fleet = await aMatchedFleet(core);
    const target = await fleet.ship('target', { valueIds: [fleet.silver] });
    const before = await discoveredBy(fleet);
    const declare = () => core.useCases.declareNetworkRules(fleet.installation, { rules: [{ verb: 'send', from: [], to: [fleet.silver] }] }).then(unwrap);
    const read = () => discoveredBy(fleet);

    // When a read queues behind the declaration, and another before it.
    const [early, , late] = await inQueueOrder(fleet.fleetId, [read, declare, read]);
    const after = await discoveredBy(fleet);

    // Then the early read saw neither, the late one both.
    expect(before).not.toContain(target);
    expect(after).toContain(target);
    expect(early).toEqual(before);
    expect(late).toEqual(after);
  });
});
