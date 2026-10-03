import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
  initialiseFleet,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createCommissionShip } from './commission-ship.js';
import type { Ship } from './ship.js';
import { newKey } from '../../../test/support/keys.js';

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
      await commissionShip(argo, { name: 'scout', type: 'reviewer', note: 'reviews pull requests', idempotencyKey: 'commission-scout' }),
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
        // The hash itself is the repeat tests' concern; here, that it is kept with the key.
        commission: { by: argoId, idempotencyKey: 'commission-scout', requestHash: shipsNamed('scout')[0]?.commission?.requestHash ?? 'none' },
      },
    ]);
    expect(core.state.leases.filter((lease) => lease.shipId === shipId)).toEqual([]);
  });

  it('stores no note when none is given', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout')[0]?.note).toBeNull();
  });

  it('issues the first starting prompt: a new secret for the ship', async () => {
    const commissioned = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(commissioned.secret).toMatch(/^aeolus_sk_v1_./);
  });

  it('stores the secret only as its hash, valid and not yet claimed', async () => {
    const commissioned = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const { shipId } = commissioned;
    const secret = secretOf(commissioned.secret);

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
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const credential = core.state.credentials.find((held) => held.shipId === shipId);

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId,
        details: { name: 'scout', type: 'reviewer', kind: 'agent', scopes: 'messages:send messages:receive' },
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

describe('the scopes of a new ship', () => {
  function scopesOf(name: string) {
    return shipsNamed(name)[0]?.scopes;
  }

  it('adds fleet:read to the scopes every agent ship has', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'watcher', type: 'squadron', fleetScopes: ['fleet:read'] }));

    expect(scopesOf('watcher')).toEqual(['messages:send', 'messages:receive', 'fleet:read']);
  });

  it('adds fleet:read and fleet:manage, in their fixed order, each once', async () => {
    unwrap(
      await commissionShip(argo, { idempotencyKey: newKey(),
        name: 'manager',
        type: 'squadron',
        fleetScopes: ['fleet:manage', 'fleet:read', 'fleet:manage'],
      }),
    );

    expect(scopesOf('manager')).toEqual(['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage']);
  });

  it('writes the scopes in ShipCommissioned', async () => {
    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'squadron', fleetScopes: ['fleet:manage'] }));

    expect(core.state.events.find((event) => event.type === 'ShipCommissioned' && event.shipId === shipId)?.details).toMatchObject({
      scopes: 'messages:send messages:receive fleet:manage',
    });
  });

  it('lets a ship with fleet:manage commission a ship with fleet scopes: no rule beyond the scopes (ADR 0016)', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'squadron', fleetScopes: ['fleet:read', 'fleet:manage'] }));
    const manager = { ...argo, shipId: shipsNamed('manager')[0]?.id ?? argo.shipId, kind: 'agent' as const };

    unwrap(await commissionShip(manager, { idempotencyKey: newKey(), name: 'deputy', type: 'squadron', fleetScopes: ['fleet:manage'] }));

    expect(scopesOf('deputy')).toEqual(['messages:send', 'messages:receive', 'fleet:manage']);
  });
});

describe('the name of a new ship', () => {
  it('is refused while an active ship holds it, and nothing changes', async () => {
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const before = structuredClone(core.state);

    const second = await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'lookout' });

    expect(second).toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN', message: 'An active ship is already named scout' },
    });
    expect(core.state).toEqual(before);
  });

  it('can be the name of a retired ship', async () => {
    const retired = addAgentShip(core, { fleetId, name: 'scout', retiredAt: core.clock.now() });

    const { shipId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    expect(shipsNamed('scout').map((ship) => [ship.id, ship.retiredAt])).toEqual([
      [retired.shipId, core.clock.now()],
      [shipId, null],
    ]);
  });

  it('can be taken in another fleet', async () => {
    addAgentShip(core, { fleetId: core.ids('fleet'), name: 'scout' });

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).resolves.toMatchObject({ isOk: true });
  });

  it('can never be argo, and nothing changes', async () => {
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'argo', type: 'reviewer' })).resolves.toEqual({
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
    await expect(commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NAME' },
    });
    expect(core.state.ships).toHaveLength(1);
  });
});

describe('the type and note of a new ship', () => {
  it('refuses a type that is not a handle', async () => {
    await expect(commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'Code Reviewer' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_SHIP_TYPE' },
    });
    expect(core.state.ships).toHaveLength(1);
  });

  it('refuses a note over 500 characters', async () => {
    const tooLong = { name: 'scout', type: 'reviewer', note: 'a'.repeat(501), idempotencyKey: newKey() };

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
    });

    await expect(commission(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).rejects.toThrow('event log unavailable');
    expect(core.state).toEqual(before);
  });
});

describe('a commission that comes again', () => {
  const scout = { name: 'scout', type: 'reviewer', note: 'reviews pull requests', idempotencyKey: 'commission-scout' };

  it('answers the original ship id and its starting prompt state, with no secret', async () => {
    const { shipId } = unwrap(await commissionShip(argo, scout));
    core.clock.advance(60_000);

    await expect(commissionShip(argo, scout)).resolves.toEqual({
      isOk: true,
      value: { shipId, secret: null, startingPrompt: { issuedAt: new Date('2026-09-29T12:00:00.000Z'), isClaimed: false } },
    });
  });

  it('commissions no second ship, issues no second secret and writes no event', async () => {
    unwrap(await commissionShip(argo, scout));
    const before = structuredClone(core.state);

    unwrap(await commissionShip(argo, scout));

    expect(core.state).toEqual(before);
  });

  it('says the starting prompt is claimed once a session claimed it', async () => {
    const commissioned = unwrap(await commissionShip(argo, scout));
    const { shipId } = commissioned;
    unwrap(await registryUseCases(core).claimShip({ shipId, secret: secretOf(commissioned.secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    const repeat = unwrap(await commissionShip(argo, scout));

    expect(repeat.startingPrompt?.isClaimed).toBe(true);
  });

  it('takes the fleet scopes in another order as the same request', async () => {
    unwrap(await commissionShip(argo, { ...scout, fleetScopes: ['fleet:read', 'fleet:manage'] }));

    await expect(commissionShip(argo, { ...scout, fleetScopes: ['fleet:manage', 'fleet:read'] })).resolves.toMatchObject({ isOk: true, value: { secret: null } });
  });

  it.each([
    ['another name', { name: 'lookout' }],
    ['another type', { type: 'lookout' }],
    ['another note', { note: 'reviews issues' }],
    ['other fleet scopes', { fleetScopes: ['fleet:read'] as const }],
  ])('refuses the same key with %s, and nothing changes', async (_label, change) => {
    unwrap(await commissionShip(argo, scout));
    const before = structuredClone(core.state);

    await expect(commissionShip(argo, { ...scout, ...change })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state).toEqual(before);
  });

  it("keeps each commissioning ship's keys apart: another ship's same key commissions a new ship", async () => {
    unwrap(await commissionShip(argo, { name: 'manager', type: 'squadron', fleetScopes: ['fleet:manage'], idempotencyKey: 'commission-manager' }));
    const manager = { ...argo, shipId: shipsNamed('manager')[0]?.id ?? argo.shipId, kind: 'agent' as const };
    unwrap(await commissionShip(argo, scout));

    const theirs = unwrap(await commissionShip(manager, { ...scout, name: 'deputy' }));

    expect(theirs.secret).not.toBeNull();
    expect(shipsNamed('deputy')).toHaveLength(1);
  });

  it.each([
    ['an empty key', ''],
    ['a key over 256 characters', 'k'.repeat(257)],
  ])('refuses %s', async (_label, idempotencyKey) => {
    await expect(commissionShip(argo, { ...scout, idempotencyKey })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_IDEMPOTENCY_KEY' } });
  });
});
