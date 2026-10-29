import { accountIdSchema, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleetWith, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { inMemoryRecoveryKeys, openedByRecoveryKey } from '../../../test/support/in-memory-recovery-keys.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';
import { createChangeRecoveryKey, type ChangeRecoveryKey } from './change-recovery-key.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';
import type { RecoveryKeys } from './recovery-key.js';
import { createRotateDataKeys } from './rotate-data-keys.js';

/**
 * Changing the recovery key (decision 0068, B13d): the fleet turned sealing
 * on under its company key with recovery key A at nine on 29 October, and its
 * data key was rotated a month later, so it holds two. The fleet manager
 * wraps every data key to recovery key B.
 */
const RECOVERY_KEY_A = 'age1recoverykeya';
const RECOVERY_KEY_B = 'age1recoverykeyb';
const FINGERPRINT_A = 'SHA256:fingerprint-of-age1recoverykeya';
const FINGERPRINT_B = 'SHA256:fingerprint-of-age1recoverykeyb';

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let companyKey: string;
let scout: ShipCaller;
let fleetManager: AccountCaller;

async function aFleetSealedWith(options: { recoveryKey?: string }): Promise<void> {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo: operatorCaller(fleet) }, { name: 'scout', type: 'reviewer', scopes: [] });
  await shipWithScopes({ registry, argo: operatorCaller(fleet) }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  fleetManager = { kind: 'account', accountId: accountIdSchema.parse('acc_ines'), fleetId, scopes: ['fleet:read', 'fleet:manage', 'fleet:keys'], groupValues: [], personShipId: null, throughShipId: null };
  companyKey = await sealFleetWith(core, { fleetId, ...options });
  await send('sealed under the first data key');
  core.clock.set('2026-11-28T09:00:00.000Z');
  await rotation()();
  await send('sealed under the second data key');
  core.state.events.length = 0;
}

beforeEach(async () => {
  await aFleetSealedWith({ recoveryKey: RECOVERY_KEY_A });
});

function changeWith(recoveryKeys: RecoveryKeys): ChangeRecoveryKey {
  return createChangeRecoveryKey({ uow: core.uow, clock: core.clock, ids: core.ids, recoveryKeys, sealing: core.sealing, sealings: core.sealings });
}

function rotation() {
  return createRotateDataKeys({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, dataKeys: core.sealing.dataKeys });
}

async function send(payload: string): Promise<void> {
  unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload, contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
}

/** Whether every data key of the fleet opens under the recovery key to the key its company key wrap holds. */
async function everyDataKeyOpensUnder(recipient: string): Promise<boolean> {
  const opened = await Promise.all(
    core.state.dataKeys.map(async (dataKey) => {
      const material = unwrap(await core.keyVault.vault.unwrap({ fleetId, companyKey }, dataKey.wrappedByCompanyKey));
      const recovered = openedByRecoveryKey(recipient, dataKey.wrappedByRecoveryKey);
      return recovered !== undefined && Buffer.from(recovered).equals(material);
    }),
  );
  return opened.length > 0 && opened.every(Boolean);
}

/** What a change must leave as it was when it is refused: the fleet's recovery key and every data key's wraps. */
function recoveryState() {
  return structuredClone({ recoveryKeys: core.state.fleetSealings.map(({ recoveryKey }) => recoveryKey), dataKeys: core.state.dataKeys });
}

describe('changing the recovery key (decision 0068, B13d)', () => {
  it('wraps every data key to the new recovery key, FleetRecoveryKeyChanged names both fingerprints, the fleet shows the new one, and no payload is rewritten', async () => {
    const messagesBefore = structuredClone(core.state.messages);

    const changed = unwrap(await changeWith(inMemoryRecoveryKeys)(fleetManager, { recoveryKey: RECOVERY_KEY_B }));

    expect(changed).toEqual({ recoveryKeyFingerprint: FINGERPRINT_B });
    expect(await everyDataKeyOpensUnder(RECOVERY_KEY_B)).toBe(true);
    expect(core.state.dataKeys).toHaveLength(2);
    expect(core.state.fleetSealings.map(({ recoveryKey }) => recoveryKey)).toEqual([{ recipient: RECOVERY_KEY_B, fingerprint: FINGERPRINT_B }]);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([
      { type: 'FleetRecoveryKeyChanged', actor: { kind: 'account', accountId: fleetManager.accountId, throughShipId: null }, details: { from: FINGERPRINT_A, to: FINGERPRINT_B } },
    ]);
    expect(core.state.messages).toEqual(messagesBefore);
  });

  it('sets a recovery key on a fleet sealed without one, every data key wrapped to it', async () => {
    await aFleetSealedWith({});

    unwrap(await changeWith(inMemoryRecoveryKeys)(fleetManager, { recoveryKey: RECOVERY_KEY_B }));

    expect(await everyDataKeyOpensUnder(RECOVERY_KEY_B)).toBe(true);
    expect(core.state.events.map(({ type, details }) => ({ type, details }))).toEqual([{ type: 'FleetRecoveryKeyChanged', details: { from: null, to: FINGERPRINT_B } }]);
  });

  it('wraps a data key rotated while the change runs to the new recovery key too', async () => {
    let hasRotated = false;
    const rotatingMeanwhile: RecoveryKeys = {
      ...inMemoryRecoveryKeys,
      wrap: async (recoveryKey, material) => {
        if (!hasRotated) {
          hasRotated = true;
          core.clock.set('2026-12-28T09:00:00.000Z');
          await rotation()();
        }
        return inMemoryRecoveryKeys.wrap(recoveryKey, material);
      },
    };

    unwrap(await changeWith(rotatingMeanwhile)(fleetManager, { recoveryKey: RECOVERY_KEY_B }));

    expect(core.state.dataKeys).toHaveLength(3);
    expect(await everyDataKeyOpensUnder(RECOVERY_KEY_B)).toBe(true);
  });

  it('refuses KEY_UNAVAILABLE when the company key is not reachable, and every wrap stays as it was', async () => {
    await core.keyVault.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    const before = recoveryState();

    const refusal = refusalOf(await changeWith(inMemoryRecoveryKeys)(fleetManager, { recoveryKey: RECOVERY_KEY_B }));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect(recoveryState()).toEqual(before);
    expect(core.state.events.map(({ type }) => type)).not.toContain('FleetRecoveryKeyChanged');
  });

  it('refuses a recovery key that is no age X25519 recipient INVALID_RECOVERY_KEY, and nothing changes', async () => {
    const before = structuredClone(core.state);

    const refusal = refusalOf(await changeWith(inMemoryRecoveryKeys)(fleetManager, { recoveryKey: 'AGE-SECRET-KEY-1NOTAPUBLICKEY' }));

    expect(refusal.kind).toBe('INVALID_RECOVERY_KEY');
    expect(core.state).toEqual(before);
  });

  it('refuses an actor without fleet:keys, and nothing changes', async () => {
    const account: AccountCaller = { ...fleetManager, accountId: accountIdSchema.parse('acc_lena'), scopes: ['fleet:read', 'fleet:manage'] };
    const before = structuredClone(core.state);

    const refusal = refusalOf(await changeWith(inMemoryRecoveryKeys)(account, { recoveryKey: RECOVERY_KEY_B }));

    expect(refusal.kind).toBe('FORBIDDEN');
    expect(core.state).toEqual(before);
  });

  it('refuses a fleet that is not sealed, FLEET_NOT_SEALED', async () => {
    core = createInMemoryCore('2026-10-29T09:00:00.000Z');
    const fleet = await initialiseFleet(core);
    const unsealed: AccountCaller = { ...fleetManager, fleetId: fleet.fleetId };

    const refusal = refusalOf(await changeWith(inMemoryRecoveryKeys)(unsealed, { recoveryKey: RECOVERY_KEY_B }));

    expect(refusal.kind).toBe('FLEET_NOT_SEALED');
  });
});
