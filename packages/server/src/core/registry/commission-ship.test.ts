import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
  FLEET_MCP_URL,
  initialiseFleet,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createCommissionShip } from './commission-ship.js';
import type { Ship } from './ship.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let commissionShip: ReturnType<typeof registryUseCases>['commissionShip'];

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  ({ commissionShip } = registryUseCases(core));
  core.state.events.length = 0;
});

function shipsNamed(name: string): Ship[] {
  return core.state.ships.filter((ship) => ship.name === name);
}

describe('commissioning a ship', () => {
  it('creates an agent ship with the scopes messages:send and messages:receive, awaiting crew', async () => {
    const { shipId } = unwrap(
      await commissionShip(argo, { name: 'scout', type: 'reviewer', note: 'reviews pull requests' }),
    );

    expect(shipsNamed('scout')).toEqual([
      {
        id: shipId,
        fleetId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        scopes: ['messages:send', 'messages:receive'],
        note: 'reviews pull requests',
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
        retiredAt: null,
      },
    ]);
    expect(core.state.leases.filter((lease) => lease.shipId === shipId)).toEqual([]);
  });

  it('stores no note when none is given', async () => {
    unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout')[0]?.note).toBeNull();
  });

  it('issues the first starting prompt, with the fleet MCP URL, the ship id and a new secret', async () => {
    const { shipId, prompt } = unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    expect(prompt).toContain(`Fleet MCP URL: ${FLEET_MCP_URL}`);
    expect(prompt).toContain(`Ship id: ${shipId}`);
    expect(secretIn(prompt)).toMatch(/^aeolus_sk_v1_./);
  });

  it('stores the secret only as its hash, valid and not yet claimed', async () => {
    const { shipId, prompt } = unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    const secret = secretIn(prompt);

    expect(core.state.credentials.filter((credential) => credential.shipId === shipId)).toEqual([
      expect.objectContaining({
        fleetId,
        secretHash: core.hasher.hash(secret),
        issuedAt: core.clock.now(),
        claimedAt: null,
        invalidatedAt: null,
      }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${secret}"`);
  });

  it('writes ShipCommissioned and StartingPromptIssued, caused by the commissioning ship', async () => {
    const { shipId } = unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    const credential = core.state.credentials.find((held) => held.shipId === shipId);

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId,
        details: { name: 'scout', type: 'reviewer', kind: 'agent' },
      }),
      expect.objectContaining({
        fleetId,
        type: 'StartingPromptIssued',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId,
        details: { credentialId: credential?.id },
      }),
    ]);
  });
});

describe('the name of a new ship', () => {
  it('is refused while an active ship holds it, and nothing changes', async () => {
    unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));
    const before = structuredClone(core.state);

    const second = await commissionShip(argo, { name: 'scout', type: 'lookout' });

    expect(second).toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN', message: 'An active ship is already named scout' },
    });
    expect(core.state).toEqual(before);
  });

  it('can be the name of a retired ship', async () => {
    const retired = addAgentShip(core, { fleetId, name: 'scout', retiredAt: core.clock.now() });

    const { shipId } = unwrap(await commissionShip(argo, { name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout').map((ship) => [ship.id, ship.retiredAt])).toEqual([
      [retired.shipId, core.clock.now()],
      [shipId, null],
    ]);
  });

  it('can be taken in another fleet', async () => {
    addAgentShip(core, { fleetId: core.ids('fleet'), name: 'scout' });

    await expect(commissionShip(argo, { name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('can never be argo, and nothing changes', async () => {
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { name: 'argo', type: 'reviewer' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_RESERVED', message: 'The name argo is reserved for the operator ship' },
    });
    expect(core.state).toEqual(before);
  });

  it.each([
    ['uppercase', 'Scout'],
    ['empty', ''],
    ['over 48 characters', 'a'.repeat(49)],
  ])('is refused when %s', async (_label, name) => {
    await expect(commissionShip(argo, { name, type: 'reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NAME' },
    });
    expect(core.state.ships).toHaveLength(1);
  });
});

describe('the type and note of a new ship', () => {
  it('refuses a type that is not a handle', async () => {
    await expect(commissionShip(argo, { name: 'scout', type: 'Code Reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_TYPE' },
    });
    expect(core.state.ships).toHaveLength(1);
  });

  it('refuses a note over 500 characters', async () => {
    const tooLong = { name: 'scout', type: 'reviewer', note: 'a'.repeat(501) };

    await expect(commissionShip(argo, tooLong)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NOTE' },
    });
    expect(core.state.ships).toHaveLength(1);
  });
});

describe('a failed commission', () => {
  it('leaves nothing behind when a write in the transaction fails', async () => {
    const before = structuredClone(core.state);
    const commission = createCommissionShip({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
      secrets: { hasher: core.hasher, random: core.random },
      mcpUrl: FLEET_MCP_URL,
    });

    await expect(commission(argo, { name: 'scout', type: 'reviewer' })).rejects.toThrow('event log unavailable');
    expect(core.state).toEqual(before);
  });
});
