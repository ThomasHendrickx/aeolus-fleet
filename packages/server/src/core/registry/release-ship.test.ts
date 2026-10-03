import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
  crewOfToken,
  deliveryIdOf,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  OPERATOR,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { createReleaseShip } from './release-ship.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let releaseShip: ReturnType<typeof createReleaseShip>;
let fleetId: FleetId;
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
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  messaging = messagingUseCases(core);
  releaseShip = createReleaseShip({ uow: core.uow, clock: core.clock, ids: core.ids });

  const commissioned = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretIn(commissioned.prompt);
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
  const { prompt } = unwrap(await useCases.getStartingPrompt(argo, { shipId }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return crewOfToken(core, crewToken);
}

/** Sends a message from argo and returns its delivery's id. */
async function sendTo(selector: Selector): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await messaging.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/28',
      contentType: 'text/plain',
      idempotencyKey: `review-${core.ids('message')}`,
    }),
  );
  return deliveryIdOf(core, messageId);
}

/** Sends a message from argo, and the crew receives it: its delivery is in flight with the crew. */
async function inFlightWith(crew: Crew, selector: Selector): Promise<DeliveryId> {
  const deliveryId = await sendTo(selector);
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

describe('releasing a crewed ship', () => {
  it('ends its lease: the ship awaits crew, and the old crew token no longer crews it', async () => {
    unwrap(await releaseShip(argo, { shipId: scoutId }));

    await expect(listed(scoutId)).resolves.toMatchObject({ status: 'awaitingCrew', location: null });
    expect(core.state.leases.find((lease) => lease.id === scout.leaseId)?.endedAt).toEqual(core.clock.now());
    await expect(identityUseCases(core).authenticate.byCrewToken(scoutCrewToken)).resolves.toMatchObject(
      { isOk: false, error: { kind: 'LEASE_ENDED' } },
    );
  });

  it('invalidates its secret: the old secret no longer claims the ship, and no prompt is out', async () => {
    unwrap(await releaseShip(argo, { shipId: scoutId }));

    await expect(
      useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' }, harness: 'claude-code' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_SHIP_ID_OR_SECRET' } });
    await expect(listed(scoutId)).resolves.toMatchObject({ startingPrompt: null });
  });

  it("returns a direct delivery in flight to the ship's inbox, its attempts kept, and the next crew receives it", async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'ship', shipId: scoutId });

    unwrap(await releaseShip(argo, { shipId: scoutId }));

    expect(stored(deliveryId)).toMatchObject({ state: 'pending', claimedByShipId: null, claimedByLeaseId: null, attempts: 1 });
    const next = await nextCrewOf(scoutId);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(next, {}));
    expect(deliveries).toEqual([expect.objectContaining({ deliveryId, attempts: 2 })]);
  });

  it('wakes the receivers of the type a returned type delivery is for, as a send does', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'type', type: 'reviewer' });
    core.state.notices.length = 0;

    unwrap(await releaseShip(argo, { shipId: scoutId }));

    expect(core.state.notices).toEqual([{ fleetId, deliveryId, recipient: { kind: 'type', type: 'reviewer' } }]);
  });

  it('returns a type delivery in flight to the queue of its type, and another ship of that type receives it', async () => {
    const deliveryId = await inFlightWith(scout, { kind: 'type', type: 'reviewer' });

    unwrap(await releaseShip(argo, { shipId: scoutId }));

    expect(stored(deliveryId)).toMatchObject({
      recipient: { kind: 'type', type: 'reviewer' },
      state: 'pending',
      claimedByShipId: null,
      attempts: 1,
    });
    const lookout = await nextCrewOf(lookoutId);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(lookout, {}));
    expect(deliveries).toEqual([expect.objectContaining({ deliveryId, attempts: 2 })]);
  });

  it('writes CredentialRevoked, LeaseRevoked and one DeliveryReturned per returned delivery, caused by the operator', async () => {
    const direct = await sendTo({ kind: 'ship', shipId: scoutId });
    const forType = await sendTo({ kind: 'type', type: 'reviewer' });
    const { deliveries } = unwrap(await messaging.receiveDeliveries(scout, { max: 2 }));
    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([direct, forType]);
    const credential = core.state.credentials.find((held) => held.shipId === scoutId && held.invalidatedAt === null);
    core.state.events.length = 0;

    unwrap(await releaseShip(argo, { shipId: scoutId }));

    const byArgo = { kind: 'ship', shipId: argoId };
    const at = core.clock.now();
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CredentialRevoked',
        occurredAt: at,
        actor: byArgo,
        shipId: scoutId,
        details: { credentialId: credential?.id },
      }),
      expect.objectContaining({
        type: 'LeaseRevoked',
        occurredAt: at,
        actor: byArgo,
        shipId: scoutId,
        details: { leaseId: scout.leaseId, reason: 'released', returnedDeliveries: 2 },
      }),
      expect.objectContaining({
        type: 'DeliveryReturned',
        actor: byArgo,
        shipId: scoutId,
        deliveryId: direct,
        details: { leaseId: scout.leaseId, attempts: 1 },
      }),
      expect.objectContaining({
        type: 'DeliveryReturned',
        actor: byArgo,
        shipId: scoutId,
        deliveryId: forType,
        details: { leaseId: scout.leaseId, attempts: 1 },
      }),
    ]);
  });
});

describe('a release refused', () => {
  /** Releases, expects the refusal, and proves the release left nothing behind. */
  async function expectRefused(
    release: { caller: Caller; shipId: ShipId },
    error: { kind: string; message?: string },
  ): Promise<void> {
    const before = structuredClone(core.state);

    await expect(releaseShip(release.caller, { shipId: release.shipId })).resolves.toMatchObject({ isOk: false, error });

    expect(core.state).toEqual(before);
  }

  it('refuses argo, which is never released, even while the operator crews it', async () => {
    unwrap(await identityUseCases(core).signIn(OPERATOR));

    await expectRefused({ caller: argo, shipId: argoId }, {
      kind: 'OPERATOR_SHIP_IS_PERMANENT',
      message: 'argo is the operator ship and can never be released',
    });
  });

  it('refuses a ship awaiting crew, and its unclaimed prompt stays valid', async () => {
    await expectRefused({ caller: argo, shipId: lookoutId }, {
      kind: 'SHIP_NOT_CREWED',
      message: 'lookout is awaiting crew: only a crewed ship is released. A new starting prompt replaces an unclaimed one',
    });
    await expect(listed(lookoutId)).resolves.toMatchObject({ startingPrompt: { isClaimed: false } });
  });

  it('refuses a retired ship', async () => {
    const { shipId } = addAgentShip(core, { fleetId, name: 'wreck', retiredAt: core.clock.now() });

    await expectRefused(
      { caller: argo, shipId },
      { kind: 'SHIP_NOT_CREWED', message: 'wreck is retired: only a crewed ship is released' },
    );
  });

  it('refuses a ship released already: it awaits crew', async () => {
    unwrap(await releaseShip(argo, { shipId: scoutId }));

    await expectRefused({ caller: argo, shipId: scoutId }, { kind: 'SHIP_NOT_CREWED' });
  });

  it('refuses a ship that does not exist', async () => {
    const unknown = core.ids('ship');

    await expectRefused(
      { caller: argo, shipId: unknown },
      { kind: 'SHIP_NOT_FOUND', message: `Ship ${unknown} does not exist` },
    );
  });

  it("refuses another fleet's ship: the caller's fleet scopes the call, and the ship stays crewed", async () => {
    await expectRefused({ caller: { ...argo, fleetId: core.ids('fleet') }, shipId: scoutId }, { kind: 'SHIP_NOT_FOUND' });
    await expect(listed(scoutId)).resolves.toMatchObject({ status: 'crewed' });
  });
});

describe('a failed release', () => {
  it('stores nothing when a write in the transaction fails: the crew keeps the ship and its delivery', async () => {
    await inFlightWith(scout, { kind: 'ship', shipId: scoutId });
    const before = structuredClone(core.state);
    const failingRelease = createReleaseShip({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
    });

    await expect(failingRelease(argo, { shipId: scoutId })).rejects.toThrow('event log unavailable');

    expect(core.state).toEqual(before);
  });
});
