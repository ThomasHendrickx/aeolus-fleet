import { SCOPES } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet, registryUseCases, withInstallationSettings } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createCreateFleet, type CreateFleet } from './create-fleet.js';

const HEMMA = { requestId: 'signup-1', name: 'hemma', operatorEmail: 'Lena@Example.com ' };
const CREATED_AT = new Date('2026-10-04T12:00:00.000Z');

let core: InMemoryCore;
let createFleet: CreateFleet;

beforeEach(() => {
  core = createInMemoryCore(CREATED_AT.toISOString());
  createFleet = createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher });
});

describe('creating a fleet for the installation', () => {
  it('creates the fleet, its argo and its operator account without a password, answering the fleet and argo', async () => {
    const { fleetId, operatorShipId } = unwrap(await createFleet(HEMMA));

    expect(core.state.fleets).toEqual([{ id: fleetId, name: 'hemma', createdAt: CREATED_AT }]);
    expect(core.state.ships).toEqual([expect.objectContaining({ id: operatorShipId, fleetId, name: 'argo', kind: 'operator', scopes: [...SCOPES] })]);
    expect(core.state.operatorAccounts).toEqual([
      expect.objectContaining({ fleetId, email: 'lena@example.com', passwordHash: null, theme: 'system', createdAt: CREATED_AT }),
    ]);
  });

  it('writes FleetInitialised and ShipCommissioned for argo with it', async () => {
    const { fleetId, operatorShipId } = unwrap(await createFleet(HEMMA));

    expect(core.state.events.map(({ fleetId: of, type, shipId }) => ({ of, type, shipId: shipId ?? null }))).toEqual([
      { of: fleetId, type: 'FleetInitialised', shipId: null },
      { of: fleetId, type: 'ShipCommissioned', shipId: operatorShipId },
    ]);
  });

  it('creates a fleet beside the fleets the installation already hosts', async () => {
    await initialiseFleet(core);

    unwrap(await createFleet(HEMMA));

    expect(core.state.fleets).toHaveLength(2);
  });

  it('gives a fleet that works: its argo commissions a ship', async () => {
    const { fleetId, operatorShipId } = unwrap(await createFleet(HEMMA));
    const argo: Caller = { fleetId, shipId: operatorShipId, kind: 'operator', scopes: [...SCOPES] };

    const commissioned = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(core.state.ships.find((ship) => ship.id === commissioned.shipId)).toMatchObject({ fleetId, name: 'scout' });
  });

  it('refuses a password sign-in for its operator exactly like a wrong password', async () => {
    unwrap(await createFleet(HEMMA));

    await expect(identityUseCases(core).signIn({ email: 'lena@example.com', password: 'anything' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'WRONG_EMAIL_OR_PASSWORD', message: 'Wrong email or password' },
    });
  });

  it("refuses an email another fleet's operator has, in any case", async () => {
    unwrap(await createFleet(HEMMA));

    await expect(createFleet({ requestId: 'signup-2', name: 'other', operatorEmail: 'LENA@example.com' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_EMAIL_TAKEN' },
    });
    expect(core.state.fleets).toHaveLength(1);
  });

  it.each([
    { refused: 'an empty name', input: { ...HEMMA, name: '  ' }, kind: 'INVALID_FLEET_NAME' },
    { refused: 'an email without @', input: { ...HEMMA, operatorEmail: 'lena' }, kind: 'INVALID_EMAIL' },
  ])('refuses $refused and creates nothing', async ({ input, kind }) => {
    await expect(createFleet(input)).resolves.toMatchObject({ isOk: false, error: { kind } });
    expect(core.state.fleets).toEqual([]);
  });
});

describe('a create that comes again under its request id', () => {
  it('answers what the first one answered, and creates nothing more', async () => {
    const first = unwrap(await createFleet(HEMMA));
    core.clock.advance(60_000);

    await expect(createFleet(HEMMA)).resolves.toEqual({ isOk: true, value: first });
    expect(core.state.fleets).toHaveLength(1);
    expect(core.state.events).toHaveLength(2);
  });

  it('answers the same when the request differs only in spacing and case of the email', async () => {
    const first = unwrap(await createFleet(HEMMA));

    await expect(createFleet({ ...HEMMA, name: ' hemma ', operatorEmail: 'lena@example.com' })).resolves.toEqual({ isOk: true, value: first });
  });

  it('refuses a different create under a used request id', async () => {
    unwrap(await createFleet(HEMMA));

    await expect(createFleet({ ...HEMMA, name: 'another' })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state.fleets).toHaveLength(1);
  });
});

describe("creating a fleet at the installation's cap", () => {
  it('takes fleets up to the cap, then refuses the next and creates nothing', async () => {
    withInstallationSettings(core, { fleetCap: 1 });
    unwrap(await createFleet(HEMMA));

    await expect(createFleet({ requestId: 'signup-2', name: 'other', operatorEmail: 'olle@example.com' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'FLEET_LIMIT_REACHED', message: 'The installation is at its cap of 1 fleets, so it creates no new one.' },
    });
    expect(core.state.fleets).toHaveLength(1);
  });

  it('still answers a create that comes again under its request id at the cap', async () => {
    withInstallationSettings(core, { fleetCap: 1 });
    const first = unwrap(await createFleet(HEMMA));

    await expect(createFleet(HEMMA)).resolves.toEqual({ isOk: true, value: first });
  });
});
