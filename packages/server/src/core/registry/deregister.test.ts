import type { DeliveryId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewOfToken,
  deliveryIdOf,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  OPERATOR,
  openLeaseOf,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { createDeregister } from './deregister.js';
import { createReleaseShip } from './release-ship.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let deregister: ReturnType<typeof createDeregister>;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let scoutSecret: string;
let scoutCrewToken: string;
let scout: Crew;
let lookoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-30T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  messaging = messagingUseCases(core);
  deregister = createDeregister({ uow: core.uow, clock: core.clock, ids: core.ids });

  const commissioned = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretOf(commissioned.secret);
  ({ crewToken: scoutCrewToken } = unwrap(
    await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' }, harness: 'claude-code' }),
  ));
  scout = await crewOfToken(core, scoutCrewToken);
  ({ shipId: lookoutId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

/** A new starting prompt for the ship and a session claiming it: the next crew. */
async function nextCrewOf(shipId: ShipId): Promise<Crew> {
  const { secret } = unwrap(await useCases.getStartingPrompt(argo, { shipId }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return crewOfToken(core, crewToken);
}

/** Sends a message from argo, and the crew receives it: its delivery is in flight with the crew. */
async function inFlightWith(crew: Crew, selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await messaging.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/28',
      contentType: 'text/plain',
      idempotencyKey: `review-${core.ids('message')}`,
    }),
  );
  const deliveryId = deliveryIdOf(core, messageId);
  const { deliveries } = unwrap(await messaging.receiveDeliveries(crew, {}));
  expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([deliveryId]);
  return deliveryId;
}

async function listed(shipId: ShipId) {
  return (await useCases.listFleet(argo)).find((ship) => ship.id === shipId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((delivery) => delivery.id === deliveryId);
}

describe('deregistering', () => {
  it("ends the crew's own lease: the ship awaits crew, and the crew token no longer crews it", async () => {
    unwrap(await deregister(scout));

    await expect(listed(scoutId)).resolves.toMatchObject({ status: 'awaitingCrew', location: null });
    expect(core.state.leases.find((lease) => lease.id === scout.leaseId)?.endedAt).toEqual(core.clock.now());
    await expect(identityUseCases(core).authenticate.byCrewToken(scoutCrewToken)).resolves.toMatchObject(
      { isOk: false, error: { kind: 'LEASE_ENDED' } },
    );
  });

  it('invalidates the secret: it no longer claims the ship, and the next crew needs a new starting prompt', async () => {
    unwrap(await deregister(scout));

    await expect(
      useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' }, harness: 'claude-code' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_SHIP_ID_OR_SECRET' } });
    await expect(listed(scoutId)).resolves.toMatchObject({ startingPrompt: null });
  });

  it("returns a direct delivery in flight to the ship's inbox, its attempts kept, and the next crew receives it", async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'ship', shipId: scoutId });

    unwrap(await deregister(scout));

    expect(stored(deliveryId)).toMatchObject({ state: 'pending', claimedByShipId: null, claimedByLeaseId: null, attempts: 1 });
    const next = await nextCrewOf(scoutId);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(next, {}));
    expect(deliveries).toEqual([expect.objectContaining({ deliveryId, attempts: 2 })]);
  });

  it('wakes the receivers of the type a returned type delivery is for, as a send does', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'type', type: 'reviewer' });
    core.state.notices.length = 0;

    unwrap(await deregister(scout));

    expect(core.state.notices).toEqual([{ fleetId: scout.fleetId, deliveryId, recipient: { kind: 'type', type: 'reviewer' } }]);
  });

  it('returns a type delivery in flight to the queue of its type, and another ship of that type receives it', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'type', type: 'reviewer' });

    unwrap(await deregister(scout));

    expect(stored(deliveryId)).toMatchObject({ state: 'pending', claimedByShipId: null, attempts: 1 });
    const lookout = await nextCrewOf(lookoutId);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(lookout, {}));
    expect(deliveries).toEqual([expect.objectContaining({ deliveryId, attempts: 2 })]);
  });

  it('writes CredentialRevoked, LeaseRevoked and DeliveryReturned, caused by the ship itself', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'ship', shipId: scoutId });
    const credential = core.state.credentials.find((held) => held.shipId === scoutId && held.invalidatedAt === null);
    core.state.events.length = 0;

    unwrap(await deregister(scout));

    const byScout = { kind: 'ship', shipId: scoutId };
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CredentialRevoked',
        actor: byScout,
        shipId: scoutId,
        details: { credentialId: credential?.id },
      }),
      expect.objectContaining({
        type: 'LeaseRevoked',
        occurredAt: core.clock.now(),
        actor: byScout,
        shipId: scoutId,
        details: { leaseId: scout.leaseId, reason: 'deregistered', returnedDeliveries: 1 },
      }),
      expect.objectContaining({
        type: 'DeliveryReturned',
        actor: byScout,
        shipId: scoutId,
        deliveryId,
        details: { leaseId: scout.leaseId, attempts: 1 },
      }),
    ]);
  });
});

describe('a deregister refused', () => {
  /** Deregisters, expects the refusal, and proves the deregister left nothing behind. */
  async function expectRefused(crew: Crew, error: { kind: string; message?: string }): Promise<void> {
    const before = structuredClone(core.state);

    await expect(deregister(crew)).resolves.toMatchObject({ isOk: false, error });

    expect(core.state).toEqual(before);
  }

  it('refuses a second deregister: the lease has ended', async () => {
    unwrap(await deregister(scout));

    await expectRefused(scout, {
      kind: 'LEASE_ENDED',
      message: 'This ship was released; this session no longer crews it.',
    });
  });

  it('refuses a crew released meanwhile, and leaves the new prompt out valid', async () => {
    unwrap(await createReleaseShip({ uow: core.uow, clock: core.clock, ids: core.ids })(argo, { shipId: scoutId }));
    unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expectRefused(scout, { kind: 'LEASE_ENDED' });
    await expect(listed(scoutId)).resolves.toMatchObject({ startingPrompt: { isClaimed: false } });
  });

  it('refuses a crew whose ship a new crew holds now, and leaves the new crew its lease', async () => {
    unwrap(await deregister(scout));
    const next = await nextCrewOf(scoutId);

    await expectRefused(scout, { kind: 'LEASE_ENDED' });
    expect(openLeaseOf(core, scoutId)).toBe(next.leaseId);
  });

  it('refuses argo, which is never released: the operator signs out instead', async () => {
    unwrap(await identityUseCases(core).signIn(OPERATOR));
    const argoCrew: Crew = { ...argo, leaseId: openLeaseOf(core, argoId) };

    await expectRefused(argoCrew, {
      kind: 'OPERATOR_SHIP_IS_PERMANENT',
      message: 'argo is the operator ship and can never be released',
    });
  });
});

describe('a failed deregister', () => {
  it('stores nothing when a write in the transaction fails: the crew keeps the ship and its delivery', async () => {
    await inFlightWith(scout, { kind: 'ship', shipId: scoutId });
    const before = structuredClone(core.state);
    const failingDeregister = createDeregister({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
    });

    await expect(failingDeregister(scout)).rejects.toThrow('event log unavailable');

    expect(core.state).toEqual(before);
  });
});
