import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { openedByRecoveryKey } from '../../../test/support/in-memory-recovery-keys.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { createRotateDataKeys } from './rotate-data-keys.js';

/**
 * Data keys by age (decision 0068, B13a): the fleet turned sealing on at nine
 * on 29 October; scout sends chief messages under its data keys, and the 30
 * second pass makes a new current data key once the current one is 30 days
 * old.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let companyKey: string;
let scout: ShipCaller;
let chief: Crew;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = crewAboard(core, await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] }));
  companyKey = await sealFleet(core, fleetId);
  core.state.events.length = 0;
});

function aPass() {
  return createRotateDataKeys({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, dataKeys: core.sealing.dataKeys });
}

async function send(payload: string): Promise<void> {
  unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload, contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
}

function dataKeys() {
  return core.state.dataKeys.map(({ createdAt, isCurrent }) => ({ createdAt: createdAt.toISOString(), isCurrent }));
}

describe('data keys by age (decision 0068, B13a)', () => {
  it('scenario 18: a current data key 30 days old gets a new current key, the old one kept, and messages sealed under both are received', async () => {
    await send('sealed under the first key');
    core.clock.set('2026-11-28T09:00:00.000Z');

    await aPass()();
    await send('sealed under the second key');

    expect(dataKeys()).toEqual([
      { createdAt: '2026-10-29T09:00:00.000Z', isCurrent: false },
      { createdAt: '2026-11-28T09:00:00.000Z', isCurrent: true },
    ]);
    const [, second] = core.state.dataKeys;
    expect(core.state.events.filter(({ type }) => type === 'FleetDataKeyCreated').map(({ actor, details }) => ({ actor, details }))).toEqual([{ actor: { kind: 'system' }, details: { dataKeyId: second?.id } }]);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(chief, { max: 10 }));
    expect(deliveries.map(({ payload }) => payload)).toEqual(['sealed under the first key', 'sealed under the second key']);
  });

  it('scenario 6: given a recovery key at turning on, a new data key is also wrapped to it', async () => {
    const other = createInMemoryCore('2026-10-29T09:00:00.000Z');
    const otherFleetId = (await initialiseFleet(other)).fleetId;
    const otherCompanyKey = await sealFleet(other, otherFleetId, { recoveryKey: 'age1recoverykeyofacme' });
    other.clock.set('2026-11-28T09:00:00.000Z');

    await createRotateDataKeys({ sealings: other.sealings, uow: other.uow, clock: other.clock, ids: other.ids, dataKeys: other.sealing.dataKeys })();

    const [, second] = other.state.dataKeys;
    const material = unwrap(await other.keyVault.vault.unwrap({ fleetId: otherFleetId, companyKey: otherCompanyKey }, second?.wrappedByCompanyKey ?? new Uint8Array()));
    expect(second?.isCurrent).toBe(true);
    expect(openedByRecoveryKey('age1recoverykeyofacme', second?.wrappedByRecoveryKey)).toEqual(material);
  });

  it('keeps a current data key younger than 30 days', async () => {
    core.clock.advance(30 * DAY_MS - 1);

    await aPass()();

    expect(dataKeys()).toEqual([{ createdAt: '2026-10-29T09:00:00.000Z', isCurrent: true }]);
  });

  it('a KMS failure keeps the current key, writes FleetKeyUnavailable on the change, and the next pass tries again', async () => {
    core.clock.set('2026-11-28T09:00:00.000Z');
    await core.keyVault.disable(companyKey);

    await aPass()();
    await aPass()();

    expect(dataKeys()).toEqual([{ createdAt: '2026-10-29T09:00:00.000Z', isCurrent: true }]);
    expect(core.state.events.map(({ type, details }) => ({ type, details }))).toEqual([{ type: 'FleetKeyUnavailable', details: { reason: 'disabled' } }]);

    await core.keyVault.enable(companyKey);
    core.clock.advance(1_000);
    await aPass()();

    expect(dataKeys().map(({ isCurrent }) => isCurrent)).toEqual([false, true]);
    expect(core.state.events.map(({ type }) => type)).toEqual(['FleetKeyUnavailable', 'FleetKeyAvailable', 'FleetDataKeyCreated']);
  });

  it("leaves a fleet whose sealing lock another server holds to that server's pass", async () => {
    core.clock.set('2026-11-28T09:00:00.000Z');
    core.state.sealingLocks.push(fleetId);

    await aPass()();

    expect(dataKeys()).toEqual([{ createdAt: '2026-10-29T09:00:00.000Z', isCurrent: true }]);
    expect(core.state.events).toEqual([]);
  });

  it('a second pass right after the first makes no second key: one current data key', async () => {
    core.clock.set('2026-11-28T09:00:00.000Z');

    await Promise.all([aPass()(), aPass()()]);

    expect(dataKeys().filter(({ isCurrent }) => isCurrent)).toHaveLength(1);
    expect(core.state.dataKeys).toHaveLength(2);
  });
});
