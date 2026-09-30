import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  addAgentShip,
  initialiseFleet,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { ClaimShipTx } from './claim-ship.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let scoutSecret: string;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  const commissioned = unwrap(await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretIn(commissioned.prompt);
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

const onDevice = { kind: 'DEVICE' } as const;

function openLeasesOf(shipId: ShipId) {
  return core.state.leases.filter((lease) => lease.shipId === shipId && lease.endedAt === null);
}

describe('claiming a ship with its secret', () => {
  it('returns a crew token and opens a lease at the reported location, holding only the hash of the token', async () => {
    const { crewToken } = unwrap(
      await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' } }),
    );

    expect(crewToken).toMatch(/^aeolus_ct_v1_./);
    const [lease] = openLeasesOf(scoutId);
    expect(lease?.id).toMatch(/^lse_/);
    expect(openLeasesOf(scoutId)).toEqual([
      {
        id: lease?.id,
        fleetId,
        shipId: scoutId,
        location: { kind: 'CLOUD', description: null },
        crewTokenHash: core.hasher.hash(crewToken),
        startedAt: core.clock.now(),
        endedAt: null,
      },
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${crewToken}"`);
  });

  it('takes an OTHER location with its description, trimmed', async () => {
    unwrap(
      await useCases.claimShip({
        shipId: scoutId,
        secret: scoutSecret,
        location: { kind: 'OTHER', description: '  a ci runner ' },
      }),
    );

    expect(openLeasesOf(scoutId)[0]?.location).toEqual({ kind: 'OTHER', description: 'a ci runner' });
  });

  it('marks the secret claimed: the ship is crewed and its prompt claimed', async () => {
    unwrap(await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }));

    const listed = await useCases.listFleet(argo);
    expect(listed.find((ship) => ship.id === scoutId)).toMatchObject({
      status: 'crewed',
      startingPrompt: { isClaimed: true },
    });
    expect(core.state.credentials.find((credential) => credential.shipId === scoutId)?.claimedAt).toEqual(
      core.clock.now(),
    );
  });

  it('writes ShipClaimed with the location, caused by the ship itself', async () => {
    unwrap(await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }));

    const [lease] = openLeasesOf(scoutId);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ShipClaimed',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        details: { leaseId: lease?.id, location: 'DEVICE', locationDescription: null },
      }),
    ]);
  });

  it('gives every claim its own crew token', async () => {
    const other = addAgentShip(core, { fleetId });

    const first = unwrap(await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }));
    const second = unwrap(await useCases.claimShip({ shipId: other.shipId, secret: other.secret, location: onDevice }));

    expect(first.crewToken).not.toBe(second.crewToken);
  });
});

describe('a claim refused', () => {
  /** Claims, expects the refusal, and proves the claim left nothing behind. */
  async function expectRefused(
    claim: Parameters<typeof useCases.claimShip>[0],
    error: { kind: string; message?: string },
  ): Promise<void> {
    const before = structuredClone(core.state);

    await expect(useCases.claimShip(claim)).resolves.toMatchObject({ isOk: false, error });

    expect(core.state).toEqual(before);
  }

  const wrongIdOrSecret = { kind: 'WRONG_SHIP_ID_OR_SECRET', message: 'Wrong ship id or secret' };

  it('refuses an unknown secret', async () => {
    await expectRefused({ shipId: scoutId, secret: 'aeolus_sk_v1_unknown', location: onDevice }, wrongIdOrSecret);
  });

  it('refuses an invalidated secret with the same error as an unknown one', async () => {
    unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expectRefused({ shipId: scoutId, secret: scoutSecret, location: onDevice }, wrongIdOrSecret);
  });

  it("refuses another ship's secret with the same error", async () => {
    const other = addAgentShip(core, { fleetId });

    await expectRefused({ shipId: scoutId, secret: other.secret, location: onDevice }, wrongIdOrSecret);
  });

  it('refuses an unknown ship id with the same error', async () => {
    await expectRefused({ shipId: core.ids('ship'), secret: scoutSecret, location: onDevice }, wrongIdOrSecret);
  });

  it('refuses a retired ship', async () => {
    const retired = addAgentShip(core, { fleetId, name: 'wreck', retiredAt: core.clock.now() });

    await expectRefused(
      { shipId: retired.shipId, secret: retired.secret, location: onDevice },
      { kind: 'SHIP_NOT_AWAITING_CREW', message: 'wreck is retired: a session claims a ship only while it awaits crew' },
    );
  });

  it('refuses argo, even with a secret stored for it', async () => {
    const secret = 'aeolus_sk_v1_stored-for-argo';
    core.state.credentials.push({
      id: core.ids('credential'),
      fleetId,
      shipId: argoId,
      secretHash: core.hasher.hash(secret),
      issuedAt: core.clock.now(),
      claimedAt: null,
      invalidatedAt: null,
    });

    await expectRefused(
      { shipId: argoId, secret, location: onDevice },
      { kind: 'OPERATOR_SHIP_HAS_NO_SECRET' },
    );
  });

  it('refuses a second claim while a lease is held, and keeps the first crew', async () => {
    const { crewToken } = unwrap(
      await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: onDevice }),
    );

    await expectRefused(
      { shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' } },
      { kind: 'SHIP_NOT_AWAITING_CREW', message: 'scout is crewed: a session claims a ship only while it awaits crew' },
    );
    expect(openLeasesOf(scoutId)).toEqual([expect.objectContaining({ crewTokenHash: core.hasher.hash(crewToken) })]);
  });

  it.each([
    ['OTHER without a description', { kind: 'OTHER' as const }],
    ['OTHER with only spaces', { kind: 'OTHER' as const, description: '   ' }],
    ['a description on DEVICE', { kind: 'DEVICE' as const, description: 'my laptop' }],
  ])('refuses %s', async (_label, location) => {
    await expectRefused({ shipId: scoutId, secret: scoutSecret, location }, { kind: 'INVALID_LOCATION' });
  });
});

describe('the ports a claim sees', () => {
  it('reads the ship but can never lock it: a new starting prompt holds it while it waits for the secret', () => {
    // Checked by the type checker: locking the ship here would deadlock with a
    // prompt that holds it and waits for the secret this claim holds.
    expectTypeOf<ClaimShipTx['ships']>().not.toHaveProperty('findForUpdate');
  });
});
