import { accountIdSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, hostedFleet, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, Crew, ShipCaller } from '../shared/caller.js';
import { createChangeCompanyKey, type ChangeCompanyKey } from './change-company-key.js';
import type { KeyVault } from './key-vault.js';
import { createRotateDataKeys } from './rotate-data-keys.js';

/**
 * Changing the company key (decision 0068, B13c): the fleet turned sealing on
 * under company key A at nine on 29 October, and its data key was rotated a
 * month later, so it holds two. The fleet manager moves every data key to
 * company key B.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let keyA: string;
let scout: ShipCaller;
let chief: Crew;
let fleetManager: AccountCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = crewAboard(core, await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] }));
  fleetManager = { kind: 'account', accountId: accountIdSchema.parse('acc_ines'), fleetId, scopes: ['fleet:read', 'fleet:manage', 'fleet:keys'], groupValues: [], personShipId: null, throughShipId: null };
  keyA = await sealFleet(core, fleetId);
  await send('sealed under the first data key');
  core.clock.set('2026-11-28T09:00:00.000Z');
  await rotation()();
  await send('sealed under the second data key');
  core.state.events.length = 0;
});

function changeWith(vault: KeyVault): ChangeCompanyKey {
  return createChangeCompanyKey({ uow: core.uow, clock: core.clock, ids: core.ids, vault, sealer: core.sealing.sealer, sealings: core.sealings, featureFlags: core.featureFlagReads });
}

/** A fleet sealed before its sealing flag went off: one a server without an installation token or a KMS reads (decision 0069). */
function theSealingFlagOff(): void {
  core.state.featureFlags.length = 0;
}

function rotation() {
  return createRotateDataKeys({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, dataKeys: core.sealing.dataKeys });
}

async function send(payload: string): Promise<void> {
  unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload, contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
}

/** A company key whose policy grants the installation for this fleet's id alone. */
async function aBoundCompanyKey(): Promise<string> {
  const companyKey = await core.keyVault.aCompanyKey();
  await core.keyVault.bindToFleet(companyKey, fleetId);
  return companyKey;
}

/** Whether every data key of the fleet opens under the company key, as its wrap holds it. */
async function everyDataKeyOpensUnder(companyKey: string): Promise<boolean> {
  const opened = await Promise.all(core.state.dataKeys.map((dataKey) => core.keyVault.vault.unwrap({ fleetId, companyKey }, dataKey.wrappedByCompanyKey)));
  return opened.every((result) => result.isOk);
}

describe('changing the company key (decision 0068, B13c)', () => {
  it('scenario 20: every data key is wrapped by the new company key, FleetCompanyKeyChanged is written, no payload is rewritten, and every message is still received', async () => {
    const keyB = await aBoundCompanyKey();
    const messagesBefore = structuredClone(core.state.messages);

    const changed = unwrap(await changeWith(core.keyVault.vault)(fleetManager, { companyKey: keyB }));
    await core.keyVault.disable(keyA);

    expect(changed).toEqual({ companyKey: keyB });
    expect(core.state.fleetSealings.map(({ companyKey }) => companyKey)).toEqual([keyB]);
    expect(core.state.dataKeys).toHaveLength(2);
    expect(await everyDataKeyOpensUnder(keyB)).toBe(true);
    expect(core.state.messages).toEqual(messagesBefore);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([
      { type: 'FleetCompanyKeyChanged', actor: { kind: 'account', accountId: fleetManager.accountId, throughShipId: null }, details: { from: keyA, to: keyB } },
    ]);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(chief, { max: 10 }));
    expect(deliveries.map(({ payload }) => payload)).toEqual(['sealed under the first data key', 'sealed under the second data key']);
  });

  it('scenario 21: an old company key that is not reachable is refused KEY_UNAVAILABLE, and nothing changes', async () => {
    const keyB = await aBoundCompanyKey();
    await core.keyVault.disable(keyA);
    const before = structuredClone(core.state);

    const refusal = refusalOf(await changeWith(core.keyVault.vault)(fleetManager, { companyKey: keyB }));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect(refusal.message).toContain('recovery');
    expect(core.state).toEqual(before);
  });

  it('checks the new key as turning sealing on does: one not bound to the fleet is refused KEY_NOT_BOUND_TO_FLEET, one the installation may not use KEY_UNAVAILABLE, and nothing changes', async () => {
    const unbound = await core.keyVault.aCompanyKey();
    const refused = await aBoundCompanyKey();
    await core.keyVault.refuseGrant(refused);
    const before = structuredClone(core.state);

    expect(refusalOf(await changeWith(core.keyVault.vault)(fleetManager, { companyKey: unbound })).kind).toBe('KEY_NOT_BOUND_TO_FLEET');
    expect(refusalOf(await changeWith(core.keyVault.vault)(fleetManager, { companyKey: refused })).kind).toBe('KEY_UNAVAILABLE');
    expect(core.state).toEqual(before);
  });

  it('refuses a fleet whose sealing flag is off FEATURE_FLAG_OFF, and nothing changes (decision 0069)', async () => {
    const keyB = await aBoundCompanyKey();
    theSealingFlagOff();
    const before = structuredClone(core.state);

    const refusal = refusalOf(await changeWith(core.keyVault.vault)(fleetManager, { companyKey: keyB }));

    expect(refusal.kind).toBe('FEATURE_FLAG_OFF');
    expect(core.state).toEqual(before);
  });

  it('refuses an actor without fleet:keys, and nothing changes', async () => {
    const keyB = await aBoundCompanyKey();
    const before = structuredClone(core.state);

    const refusal = refusalOf(await changeWith(core.keyVault.vault)({ ...fleetManager, scopes: ['fleet:read', 'fleet:manage'] }, { companyKey: keyB }));

    expect(refusal.kind).toBe('FORBIDDEN');
    expect(core.state).toEqual(before);
  });

  it('refuses a fleet that is not sealed, FLEET_NOT_SEALED', async () => {
    const other = await hostedFleet(core);
    core.state.featureFlags.push({ fleetId: other.fleetId, flag: 'sealing' });
    const keyB = await core.keyVault.aCompanyKey();
    await core.keyVault.bindToFleet(keyB, other.fleetId);

    const refusal = refusalOf(await changeWith(core.keyVault.vault)({ ...fleetManager, fleetId: other.fleetId }, { companyKey: keyB }));

    expect(refusal.kind).toBe('FLEET_NOT_SEALED');
  });

  it('a data key rotated while the keys are rewrapped is rewrapped too: every data key opens under the new company key', async () => {
    const keyB = await aBoundCompanyKey();
    let isRotated = false;
    const rotatingVault: KeyVault = {
      ...core.keyVault.vault,
      rewrap: async (change, wrapped) => {
        if (!isRotated) {
          isRotated = true;
          core.clock.set('2026-12-28T09:00:00.000Z');
          await rotation()();
        }
        return core.keyVault.vault.rewrap(change, wrapped);
      },
    };

    unwrap(await changeWith(rotatingVault)(fleetManager, { companyKey: keyB }));

    expect(core.state.dataKeys).toHaveLength(3);
    expect(await everyDataKeyOpensUnder(keyB)).toBe(true);
  });
});
