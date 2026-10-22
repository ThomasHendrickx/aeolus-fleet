import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';

// The messages per fleet and UTC day on a real Postgres (performance design,
// decision 1): each message stored adds one and its payload's UTF-8 bytes to
// its fleet's row for the UTC day it is stored, in the send's transaction, so
// a send rolled back counts nothing and concurrent sends are each counted.

let core: PostgresCore;
let fleetId: FleetId;
let scoutId: ShipId;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  core.clock.set('2026-10-04T12:00:00.000Z');
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
});

afterEach(async () => {
  await core.close();
});

const dayRows = z.array(z.object({ day: z.string(), messages: z.number(), payloadBytes: z.bigint() }));

/** The fleet's rows of messages per UTC day, oldest first. */
async function daysOf(fleet: FleetId) {
  return dayRows.parse(
    await core.prisma.$queryRaw`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, messages, payload_bytes AS "payloadBytes"
      FROM message_days WHERE fleet_id = ${fleet} ORDER BY day`,
  );
}

function send(payload: string) {
  return core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: scoutId }, payload, idempotencyKey: newKey() });
}

describe('the messages per fleet and UTC day', () => {
  it("count each message and its payload's UTF-8 bytes on the UTC day it is stored", async () => {
    unwrap(await send('Prüfe ✓'));
    unwrap(await send('Review'));

    // "Prüfe ✓" is 10 bytes in UTF-8 (ü two, ✓ three), "Review" 6.
    await expect(daysOf(fleetId)).resolves.toEqual([{ day: '2026-10-04', messages: 2, payloadBytes: 16n }]);
  });

  it('count a message stored at 23:59:59.999 UTC on that day, and one at 00:00 UTC on the next', async () => {
    core.clock.set('2026-10-04T23:59:59.999Z');
    unwrap(await send('late'));
    core.clock.set('2026-10-05T00:00:00.000Z');
    unwrap(await send('early'));

    await expect(daysOf(fleetId)).resolves.toEqual([
      { day: '2026-10-04', messages: 1, payloadBytes: 4n },
      { day: '2026-10-05', messages: 1, payloadBytes: 5n },
    ]);
  });

  it('count nothing for a send whose transaction fails at commit, after every statement ran', async () => {
    unwrap(await send('Review'));
    // A deferred trigger fails the transaction at its commit, after the count was added.
    await core.prisma.$executeRawUnsafe(`CREATE FUNCTION fail_at_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'disk full'; END $$ LANGUAGE plpgsql`);
    await core.prisma.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER fail_at_commit AFTER INSERT ON messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_at_commit()',
    );

    await expect(send('Lost')).rejects.toThrow('disk full');

    await expect(daysOf(fleetId)).resolves.toEqual([{ day: '2026-10-04', messages: 1, payloadBytes: 6n }]);
    await expect(core.prisma.message.count({ where: { fleetId } })).resolves.toBe(1);
  });

  it('count every one of many concurrent sends', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => send('Note')));

    expect(results.every((result) => result.isOk)).toBe(true);
    await expect(daysOf(fleetId)).resolves.toEqual([{ day: '2026-10-04', messages: 12, payloadBytes: 48n }]);
  });

  it("keep each fleet's messages on its own row", async () => {
    const other = unwrap(await core.useCases.createFleet({ requestId: newKey(), name: 'away fleet', operatorEmail: 'away@example.com' }));
    unwrap(await core.useCases.sendMessage(operatorCaller(other), { selector: { kind: 'ship', name: 'argo' }, payload: 'Hi', idempotencyKey: newKey() }));
    unwrap(await send('Review'));

    await expect(daysOf(other.fleetId)).resolves.toEqual([{ day: '2026-10-04', messages: 1, payloadBytes: 2n }]);
    await expect(daysOf(fleetId)).resolves.toEqual([{ day: '2026-10-04', messages: 1, payloadBytes: 6n }]);
  });
});
