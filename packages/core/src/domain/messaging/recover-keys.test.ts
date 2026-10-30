import { accountIdSchema, type DataKeyId, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleetWith, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { openedByRecoveryKey } from '../../../test/support/in-memory-recovery-keys.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, Crew, ShipCaller } from '../shared/caller.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';
import type { WrappedDataKey } from './key-vault.js';
import { createRecoverKeys, type RecoverKeys } from './recover-keys.js';
import { createRotateDataKeys } from './rotate-data-keys.js';

/**
 * Recovering the data keys (decision 0068, B15): the fleet turned sealing on
 * under company key A with a recovery key at nine on 29 October, and its data
 * key was rotated a month later, so it holds two, a message sealed under
 * each. Then company key A was lost. The company opens each data key with its
 * offline recovery key on its own computer, wraps each under its new company
 * key B for this fleet, and uploads them.
 */
const RECOVERY_KEY = 'age1recoverykey';

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let keyA: string;
let scout: ShipCaller;
let chief: Crew;
let fleetManager: AccountCaller;

async function aFleetSealedWith(options: { recoveryKey?: string }): Promise<void> {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = crewAboard(core, await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] }));
  fleetManager = { kind: 'account', accountId: accountIdSchema.parse('acc_ines'), fleetId, scopes: ['fleet:read', 'fleet:manage', 'fleet:keys'], groupValues: [], personShipId: null, throughShipId: null };
  keyA = await sealFleetWith(core, { fleetId, ...options });
  await send('sealed under the first data key');
  core.clock.set('2026-11-28T09:00:00.000Z');
  await createRotateDataKeys({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, dataKeys: core.sealing.dataKeys })();
  await send('sealed under the second data key');
  await loseKeyA();
  core.state.events.length = 0;
}

beforeEach(async () => {
  await aFleetSealedWith({ recoveryKey: RECOVERY_KEY });
});

async function send(payload: string): Promise<void> {
  unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload, contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
}

/** Company key A is gone, and every server's data key cache ran out. */
async function loseKeyA(): Promise<void> {
  await core.keyVault.disable(keyA);
  core.clock.advance(DATA_KEY_CACHE_MS);
}

function recoverKeys(): RecoverKeys {
  return createRecoverKeys({ uow: core.uow, clock: core.clock, ids: core.ids, vault: core.keyVault.vault, sealer: core.sealing.sealer, sealings: core.sealings, featureFlags: core.featureFlagReads });
}

/** A fleet sealed before its sealing flag went off: one a server without an installation token or a KMS reads (decision 0069). */
function theSealingFlagOff(): void {
  core.state.featureFlags.length = 0;
}

/** A company key whose policy grants the installation for this fleet's id alone. */
async function aBoundCompanyKey(): Promise<string> {
  const companyKey = await core.keyVault.aCompanyKey();
  await core.keyVault.bindToFleet(companyKey, fleetId);
  return companyKey;
}

/** What the recovery command uploads: each data key opened with the offline key and wrapped under the new company key for this fleet. */
async function theCompanysWraps(companyKey: string): Promise<{ id: DataKeyId; wrappedByCompanyKey: WrappedDataKey }[]> {
  return Promise.all(
    core.state.dataKeys.map(async ({ id, wrappedByRecoveryKey }) => {
      const material = openedByRecoveryKey(RECOVERY_KEY, wrappedByRecoveryKey);
      expect(material).toBeDefined();
      return { id, wrappedByCompanyKey: unwrap(await core.keyVault.vault.wrap({ fleetId, companyKey }, material ?? new Uint8Array())) };
    }),
  );
}

/** What a refused recovery must leave as it was: the fleet's sealing and every data key's wraps. */
function keysState() {
  return structuredClone({ sealings: core.state.fleetSealings, dataKeys: core.state.dataKeys });
}

describe('recovering the data keys (decision 0068, B15)', () => {
  it('scenario 26: given a lost company key and a recovery key, when the company runs the recovery command with its offline key and a new company key, then FleetKeysRecovered is written and every message is received again', async () => {
    const keyB = await aBoundCompanyKey();
    const dataKeys = await theCompanysWraps(keyB);
    const messagesBefore = structuredClone(core.state.messages);

    const recovered = unwrap(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys }));

    expect(recovered).toEqual({ companyKey: keyB });
    expect(core.state.fleetSealings.map(({ companyKey }) => companyKey)).toEqual([keyB]);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([
      { type: 'FleetKeysRecovered', actor: { kind: 'account', accountId: fleetManager.accountId, throughShipId: null }, details: { companyKey: keyB } },
    ]);
    expect(core.state.messages).toEqual(messagesBefore);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(chief, { max: 10 }));
    expect(deliveries.map(({ payload }) => payload)).toEqual(['sealed under the first data key', 'sealed under the second data key']);
  });

  it('scenario 27: given a recovery upload with one wrap that opens to another key, then it is refused whole and nothing changes', async () => {
    const keyB = await aBoundCompanyKey();
    const [first, second] = await theCompanysWraps(keyB);
    const anotherKey = unwrap(await core.keyVault.vault.wrap({ fleetId, companyKey: keyB }, new Uint8Array(32).fill(7)));
    const dataKeys = [first, second].flatMap((dataKey, index) => (dataKey === undefined ? [] : [index === 1 ? { id: dataKey.id, wrappedByCompanyKey: anotherKey } : dataKey]));
    expect(dataKeys).toHaveLength(2);
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys }));

    expect(refusal.kind).toBe('RECOVERY_KEYS_MISMATCH');
    expect(keysState()).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it('refuses an upload that leaves out one of the fleet data keys, RECOVERY_KEYS_MISMATCH, and nothing changes', async () => {
    const keyB = await aBoundCompanyKey();
    const [first] = await theCompanysWraps(keyB);
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys: first === undefined ? [] : [first] }));

    expect(refusal.kind).toBe('RECOVERY_KEYS_MISMATCH');
    expect(keysState()).toEqual(before);
  });

  it('refuses a new company key granted without a fleet condition, KEY_NOT_BOUND_TO_FLEET, and nothing changes', async () => {
    const unbound = await core.keyVault.aCompanyKey();
    const dataKeys = await theCompanysWraps(unbound);
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: unbound, dataKeys }));

    expect(refusal.kind).toBe('KEY_NOT_BOUND_TO_FLEET');
    expect(keysState()).toEqual(before);
  });

  it('refuses a new company key the installation may not use, KEY_UNAVAILABLE, and nothing changes', async () => {
    const keyB = await aBoundCompanyKey();
    const dataKeys = await theCompanysWraps(keyB);
    await core.keyVault.refuseGrant(keyB);
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys }));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect(keysState()).toEqual(before);
  });

  it('refuses a fleet sealed without a recovery key, NO_RECOVERY_KEY', async () => {
    await aFleetSealedWith({});
    const keyB = await aBoundCompanyKey();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys: [] }));

    expect(refusal.kind).toBe('NO_RECOVERY_KEY');
  });

  it('refuses a fleet that is not sealed, FLEET_NOT_SEALED', async () => {
    core = createInMemoryCore('2026-10-29T09:00:00.000Z');
    const fleet = await initialiseFleet(core);
    core.state.featureFlags.push({ fleetId: fleet.fleetId, flag: 'sealing' });

    const refusal = refusalOf(await recoverKeys()({ ...fleetManager, fleetId: fleet.fleetId }, { companyKey: keyA, dataKeys: [] }));

    expect(refusal.kind).toBe('FLEET_NOT_SEALED');
  });

  it('refuses a fleet whose sealing flag is off FEATURE_FLAG_OFF, and nothing changes (decision 0069)', async () => {
    const keyB = await aBoundCompanyKey();
    const dataKeys = await theCompanysWraps(keyB);
    theSealingFlagOff();
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(fleetManager, { companyKey: keyB, dataKeys }));

    expect(refusal.kind).toBe('FEATURE_FLAG_OFF');
    expect(keysState()).toEqual(before);
  });

  it('refuses an actor without fleet:keys, and nothing changes', async () => {
    const account: AccountCaller = { ...fleetManager, accountId: accountIdSchema.parse('acc_lena'), scopes: ['fleet:read', 'fleet:manage'] };
    const keyB = await aBoundCompanyKey();
    const dataKeys = await theCompanysWraps(keyB);
    const before = keysState();

    const refusal = refusalOf(await recoverKeys()(account, { companyKey: keyB, dataKeys }));

    expect(refusal.kind).toBe('FORBIDDEN');
    expect(keysState()).toEqual(before);
  });
});
