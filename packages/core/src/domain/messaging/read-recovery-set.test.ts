import { accountIdSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleetWith, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { openedByRecoveryKey } from '../../../test/support/in-memory-recovery-keys.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';
import { createReadRecoverySet, type ReadRecoverySet } from './read-recovery-set.js';
import { createRotateDataKeys } from './rotate-data-keys.js';

/**
 * The recovery set (decision 0068, B15): the fleet turned sealing on under
 * its company key with a recovery key at nine on 29 October, and its data key
 * was rotated a month later, so it holds two. The fleet manager reads what
 * the recovery command opens on the company's computer.
 */
const RECOVERY_KEY = 'age1recoverykey';
const FINGERPRINT = 'SHA256:fingerprint-of-age1recoverykey';

let core: InMemoryCore;
let fleetId: FleetId;
let companyKey: string;
let fleetManager: AccountCaller;

async function aFleetSealedWith(options: { recoveryKey?: string }): Promise<void> {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const registry = registryUseCases(core);
  const scout: ShipCaller = await shipWithScopes({ registry, argo: operatorCaller(fleet) }, { name: 'scout', type: 'reviewer', scopes: [] });
  await shipWithScopes({ registry, argo: operatorCaller(fleet) }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  fleetManager = { kind: 'account', accountId: accountIdSchema.parse('acc_ines'), fleetId, scopes: ['fleet:read', 'fleet:manage', 'fleet:keys'], groupValues: [], personShipId: null, throughShipId: null };
  companyKey = await sealFleetWith(core, { fleetId, ...options });
  const messaging = messagingUseCases(core);
  unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: 'sealed under the first data key', contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
  core.clock.set('2026-11-28T09:00:00.000Z');
  await createRotateDataKeys({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, dataKeys: core.sealing.dataKeys })();
  core.state.events.length = 0;
}

beforeEach(async () => {
  await aFleetSealedWith({ recoveryKey: RECOVERY_KEY });
});

function readRecoverySet(): ReadRecoverySet {
  return createReadRecoverySet({ sealings: core.sealings, featureFlags: core.featureFlagReads });
}

/** A fleet sealed before its sealing flag went off: one a server without an installation token or a KMS reads (decision 0069). */
function theSealingFlagOff(): void {
  core.state.featureFlags.length = 0;
}

describe('the recovery set (decision 0068, B15)', () => {
  it('answers the fleet, its recovery key by fingerprint, and each data key wrapped to the recovery key with its check value, oldest first', async () => {
    const set = unwrap(await readRecoverySet()(fleetManager));

    expect(set.fleetId).toBe(fleetId);
    expect(set.recoveryKeyFingerprint).toBe(FINGERPRINT);
    expect(set.dataKeys.map(({ id }) => id)).toEqual(core.state.dataKeys.map(({ id }) => id));
    for (const dataKey of set.dataKeys) {
      const stored = core.state.dataKeys.find(({ id }) => id === dataKey.id);
      const material = openedByRecoveryKey(RECOVERY_KEY, dataKey.wrappedByRecoveryKey);
      expect(material).toBeDefined();
      expect(Buffer.from(core.sealing.sealer.checkValue(material ?? new Uint8Array())).equals(Buffer.from(dataKey.checkValue))).toBe(true);
      expect(stored?.checkValue).toEqual(dataKey.checkValue);
    }
  });

  it('scenario 28: given the recovery set, then it holds no data key any Aeolus key can open', async () => {
    const set = unwrap(await readRecoverySet()(fleetManager));

    for (const dataKey of set.dataKeys) {
      expect(Object.keys(dataKey).sort()).toEqual(['checkValue', 'id', 'wrappedByRecoveryKey']);
      expect((await core.keyVault.vault.unwrap({ fleetId, companyKey }, dataKey.wrappedByRecoveryKey)).isOk).toBe(false);
    }
    expect(core.state.events).toEqual([]);
  });

  it('refuses a fleet sealed without a recovery key, NO_RECOVERY_KEY', async () => {
    await aFleetSealedWith({});

    expect(refusalOf(await readRecoverySet()(fleetManager)).kind).toBe('NO_RECOVERY_KEY');
  });

  it('refuses a fleet that is not sealed, FLEET_NOT_SEALED', async () => {
    core = createInMemoryCore('2026-10-29T09:00:00.000Z');
    const fleet = await initialiseFleet(core);

    expect(refusalOf(await readRecoverySet()({ ...fleetManager, fleetId: fleet.fleetId })).kind).toBe('FLEET_NOT_SEALED');
  });

  it('refuses a fleet whose sealing flag is off FEATURE_FLAG_OFF (decision 0069)', async () => {
    theSealingFlagOff();

    expect(refusalOf(await readRecoverySet()(fleetManager)).kind).toBe('FEATURE_FLAG_OFF');
  });

  it('refuses an actor without fleet:keys', async () => {
    const account: AccountCaller = { ...fleetManager, accountId: accountIdSchema.parse('acc_lena'), scopes: ['fleet:read', 'fleet:manage'] };

    expect(refusalOf(await readRecoverySet()(account)).kind).toBe('FORBIDDEN');
  });
});
