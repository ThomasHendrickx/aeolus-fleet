import { accountIdSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { createInMemoryKeyVault } from '../../../test/support/in-memory-key-vault.js';
import type { KeyVaultWorld } from '../../../test/support/key-vault-contract.js';
import { inMemoryPayloadSealer } from '../../../test/support/in-memory-payload-sealer.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, InstallationCaller, ShipCaller } from '../shared/caller.js';
import { createTurnOnSealing, type TurnOnSealing } from './turn-on-sealing.js';

let core: InMemoryCore;
let world: KeyVaultWorld;
let turnOnSealing: TurnOnSealing;
let fleetId: FleetId;
let operatorShipId: ShipId;
let fleetManager: AccountCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  world = createInMemoryKeyVault();
  turnOnSealing = createTurnOnSealing({ uow: core.uow, clock: core.clock, ids: core.ids, vault: world.vault, sealer: inMemoryPayloadSealer, sealings: core.sealings });
  ({ fleetId, operatorShipId } = await hostedFleet(core));
  fleetManager = { kind: 'account', accountId: accountIdSchema.parse('acc_ines'), fleetId, scopes: ['fleet:read', 'fleet:manage', 'fleet:keys'], groupValues: [], personShipId: null, throughShipId: null };
  core.state.events.length = 0;
});

/** A company key whose policy grants the installation for this fleet's id alone. */
async function aBoundCompanyKey(): Promise<string> {
  const companyKey = await world.aCompanyKey();
  await world.bindToFleet(companyKey, fleetId);
  return companyKey;
}

describe('turning sealing on (decision 0068, B4)', () => {
  it('scenario 1: a company key granted for this fleet seals the empty fleet with one current data key, and FleetSealingTurnedOn names the key reference and no key material', async () => {
    const companyKey = await aBoundCompanyKey();

    const turnedOn = unwrap(await turnOnSealing(fleetManager, { companyKey }));

    expect(turnedOn).toEqual({ state: 'sealed', companyKey });
    expect(core.state.fleetSealings).toEqual([{ fleetId, state: 'sealed', companyKey, keyAvailability: { isAvailable: true, since: new Date('2026-10-29T12:00:00.000Z') } }]);
    const [dataKey, ...others] = core.state.dataKeys;
    expect(others).toEqual([]);
    expect(dataKey).toMatchObject({ fleetId, isCurrent: true, createdAt: new Date('2026-10-29T12:00:00.000Z') });
    expect(dataKey?.id).toMatch(/^dky_/);
    expect(core.state.events.map(({ type, actor, details }) => ({ type, actor, details }))).toEqual([
      { type: 'FleetSealingTurnedOn', actor: { kind: 'account', accountId: fleetManager.accountId, throughShipId: null }, details: { companyKey } },
    ]);
  });

  it('scenario 2: a company key granted without a fleet condition is refused KEY_NOT_BOUND_TO_FLEET and the fleet is unchanged', async () => {
    const companyKey = await world.aCompanyKey();
    const before = structuredClone(core.state);

    const refusal = refusalOf(await turnOnSealing(fleetManager, { companyKey }));

    expect(refusal.kind).toBe('KEY_NOT_BOUND_TO_FLEET');
    expect(core.state).toEqual(before);
  });

  it('scenario 3: a company key the installation may not use is refused KEY_UNAVAILABLE naming access denied, and nothing is stored', async () => {
    const companyKey = await aBoundCompanyKey();
    await world.refuseGrant(companyKey);
    const before = structuredClone(core.state);

    const refusal = refusalOf(await turnOnSealing(fleetManager, { companyKey }));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect(refusal.message).toContain('access denied');
    expect(core.state).toEqual(before);
  });

  it('scenario 4: an account without fleet:keys is refused and nothing changes, nor does a ship or the installation without it', async () => {
    const companyKey = await aBoundCompanyKey();
    const account: AccountCaller = { kind: 'account', accountId: accountIdSchema.parse('acc_lena'), fleetId, scopes: ['fleet:read', 'fleet:manage'], groupValues: [], personShipId: null, throughShipId: null };
    const ship: ShipCaller = { kind: 'agent', shipId: operatorShipId, fleetId, scopes: ['fleet:read', 'fleet:manage'] };
    const installation: InstallationCaller = { kind: 'installation', fleetId, scopes: ['fleet:read', 'fleet:manage'] };
    const before = structuredClone(core.state);

    expect(refusalOf(await turnOnSealing(account, { companyKey })).kind).toBe('FORBIDDEN');
    expect(refusalOf(await turnOnSealing(ship, { companyKey })).kind).toBe('FORBIDDEN');
    expect(refusalOf(await turnOnSealing(installation, { companyKey })).kind).toBe('FORBIDDEN');
    expect(core.state).toEqual(before);
  });

  it('argo, holding every scope, turns sealing on', async () => {
    const argo: ShipCaller = { kind: 'operator', shipId: operatorShipId, fleetId, scopes: ['fleet:read', 'fleet:keys'] };

    expect(unwrap(await turnOnSealing(argo, { companyKey: await aBoundCompanyKey() })).state).toBe('sealed');
  });

  it('refuses a fleet that is sealed already, and nothing changes', async () => {
    unwrap(await turnOnSealing(fleetManager, { companyKey: await aBoundCompanyKey() }));
    const before = structuredClone(core.state);

    const refusal = refusalOf(await turnOnSealing(fleetManager, { companyKey: await aBoundCompanyKey() }));

    expect(refusal.kind).toBe('FLEET_ALREADY_SEALED');
    expect(core.state).toEqual(before);
  });
});
