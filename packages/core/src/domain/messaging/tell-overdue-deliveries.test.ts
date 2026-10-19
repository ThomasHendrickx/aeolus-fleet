import type { DeliveryId, FleetId, ShipId, TurnState } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller, Crew } from '../shared/caller.js';
import { SYSTEM } from '../shared/events.js';
import type { Selector } from '../shared/selector.js';
import { createTellOverdueDeliveries, type TellOverdueDeliveries } from './tell-overdue-deliveries.js';

const MINUTE = 60_000;

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let tellOverdueDeliveries: TellOverdueDeliveries;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-12T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  tellOverdueDeliveries = theClocks();
  core.state.events.length = 0;
});

/** The clocks as core runs them, on the in-memory clock. */
function theClocks(): TellOverdueDeliveries {
  return createTellOverdueDeliveries({ fleets: core.fleets, pushedCrews: core.pushedCrews, uow: core.uow, clock: core.clock, ids: core.ids });
}

/** The scout's lease is pushed now: its computer side push received for it. */
function pushed(crew: Crew = scout): void {
  core.state.pushedLeases.push({ fleetId, leaseId: crew.leaseId, at: core.clock.now() });
}

async function sendTo(selector: Selector = { kind: 'ship', shipId: scoutId }): Promise<DeliveryId> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, {
      selector,
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
    }),
  );
  return deliveryIdOf(core, messageId);
}

async function turn(state: TurnState, crew: Crew = scout): Promise<void> {
  unwrap(await registryUseCases(core).reportTurn(crew, { turn: state, at: core.clock.now() }));
}

/** A delivery to the scout, push received and handed as number 1, not confirmed. */
async function handed(): Promise<DeliveryId> {
  const deliveryId = await sendTo();
  unwrap(await useCases.pushReceiveDeliveries(scout, {}));
  unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
  return deliveryId;
}

function overdueEvents() {
  return core.state.events.filter((event) => event.type === 'DeliveryOverdue');
}

/** Moves the clock and runs the clocks, as a pass does. */
async function after(ms: number): Promise<void> {
  core.clock.advance(ms);
  await tellOverdueDeliveries();
}

describe('the 10 minute clock of a delivery handed and not confirmed', () => {
  it('tells argo once 10 minutes have passed since the hand-over', async () => {
    const deliveryId = await handed();

    await after(10 * MINUTE);

    expect(overdueEvents()).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'DeliveryOverdue',
        occurredAt: core.clock.now(),
        actor: SYSTEM,
        shipId: scoutId,
        deliveryId,
        details: { leaseId: scout.leaseId, clock: 'notConfirmed', minutes: 10 },
      }),
    ]);
  });

  it('tells nothing a moment before 10 minutes', async () => {
    await handed();

    await after(10 * MINUTE - 1);

    expect(overdueEvents()).toEqual([]);
  });

  it('tells argo only once, however many passes follow', async () => {
    await handed();

    await after(10 * MINUTE);
    await after(MINUTE);
    await after(60 * MINUTE);

    expect(overdueEvents()).toHaveLength(1);
  });

  it('tells nothing again after a restart: the told delivery is kept, not the process', async () => {
    await handed();
    await after(10 * MINUTE);

    const restarted = theClocks();
    core.clock.advance(MINUTE);
    await restarted();

    expect(overdueEvents()).toHaveLength(1);
  });

  it('runs whatever the turn: a busy session that does not confirm is told at 10 minutes too', async () => {
    await handed();
    await turn('busy');

    await after(10 * MINUTE);

    expect(overdueEvents().map((event) => event.details)).toEqual([{ leaseId: scout.leaseId, clock: 'notConfirmed', minutes: 10 }]);
  });

  it('starts again with a new hand-over number', async () => {
    const deliveryId = await handed();
    core.clock.advance(6 * MINUTE);
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2 }));

    await after(6 * MINUTE);
    expect(overdueEvents()).toEqual([]);

    await after(4 * MINUTE);
    expect(overdueEvents()).toHaveLength(1);
  });

  it('tells nothing of a delivery confirmed in time', async () => {
    const deliveryId = await handed();
    core.clock.advance(9 * MINUTE);
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));

    await after(60 * MINUTE);

    expect(overdueEvents()).toEqual([]);
  });
});

describe('the 10 minute clock of a delivery waiting while the session is idle', () => {
  it('tells argo of a pending delivery after 10 minutes idle', async () => {
    pushed();
    await turn('idle');
    const deliveryId = await sendTo();

    await after(10 * MINUTE);

    expect(overdueEvents()).toEqual([
      expect.objectContaining({ shipId: scoutId, deliveryId, details: { leaseId: scout.leaseId, clock: 'idle', minutes: 10 } }),
    ]);
  });

  it('tells nothing a moment before 10 minutes', async () => {
    pushed();
    await turn('idle');
    await sendTo();

    await after(10 * MINUTE - 1);

    expect(overdueEvents()).toEqual([]);
  });

  it('tells argo of a received delivery not handed after 10 minutes idle', async () => {
    await turn('idle');
    const deliveryId = await sendTo();
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));

    await after(10 * MINUTE);

    expect(overdueEvents()).toEqual([expect.objectContaining({ deliveryId, details: { leaseId: scout.leaseId, clock: 'idle', minutes: 10 } })]);
  });

  it('counts from the turn turning idle, not from the send', async () => {
    pushed();
    await turn('busy');
    await sendTo();
    core.clock.advance(30 * MINUTE);
    await turn('idle');

    await after(10 * MINUTE - 1);
    expect(overdueEvents()).toEqual([]);

    await after(1);
    expect(overdueEvents().map((event) => event.details)).toEqual([{ leaseId: scout.leaseId, clock: 'idle', minutes: 10 }]);
  });

  it('counts a pushed lease without a reported turn as idle since it was pushed', async () => {
    const deliveryId = await sendTo();
    core.clock.advance(30 * MINUTE);
    pushed();

    await after(10 * MINUTE - 1);
    expect(overdueEvents()).toEqual([]);

    await after(1);
    expect(overdueEvents()).toEqual([expect.objectContaining({ deliveryId, details: { leaseId: scout.leaseId, clock: 'idle', minutes: 10 } })]);
  });

  it('runs for a delivery to the ship type', async () => {
    pushed();
    await turn('idle');
    const deliveryId = await sendTo({ kind: 'type', type: 'reviewer' });

    await after(10 * MINUTE);

    expect(overdueEvents()).toEqual([expect.objectContaining({ shipId: scoutId, deliveryId })]);
  });
});

describe('the 60 minute clock of a delivery waiting while the session is busy', () => {
  it('tells argo after 60 minutes busy, not at 10', async () => {
    pushed();
    await turn('busy');
    const deliveryId = await sendTo();

    await after(60 * MINUTE - 1);
    expect(overdueEvents()).toEqual([]);

    await after(1);
    expect(overdueEvents()).toEqual([
      expect.objectContaining({ shipId: scoutId, deliveryId, details: { leaseId: scout.leaseId, clock: 'busy', minutes: 60 } }),
    ]);
  });

  it('runs for a received delivery whose session turned busy and died', async () => {
    const deliveryId = await sendTo();
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    await turn('busy');

    await after(60 * MINUTE);

    expect(overdueEvents()).toEqual([expect.objectContaining({ deliveryId, details: { leaseId: scout.leaseId, clock: 'busy', minutes: 60 } })]);
  });
});

describe('which ships and deliveries the clocks tell of', () => {
  it('never runs for a ship that pulls', async () => {
    await sendTo();

    await after(120 * MINUTE);

    expect(overdueEvents()).toEqual([]);
  });

  it('tells only of the oldest delivery of a ship whose clocks ran out, and of the next once that one is confirmed', async () => {
    pushed();
    await turn('idle');
    const oldest = await sendTo();
    core.clock.advance(MINUTE);
    const next = await sendTo();

    await after(20 * MINUTE);
    expect(overdueEvents().map((event) => event.deliveryId)).toEqual([oldest]);

    unwrap(await useCases.pushReceiveDeliveries(scout, { max: 1 }));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId: oldest }));
    await after(MINUTE);
    expect(overdueEvents().map((event) => event.deliveryId)).toEqual([oldest, next]);
  });

  it('stops when the lease ends: its deliveries return to pending and the new lease pulls', async () => {
    await handed();
    unwrap(await registryUseCases(core).releaseShip(argo, { shipId: scoutId }));

    await after(60 * MINUTE);

    expect(overdueEvents()).toEqual([]);
  });

  it('tells again of the same delivery on a new lease of the ship', async () => {
    pushed();
    await turn('idle');
    const deliveryId = await sendTo();
    await after(10 * MINUTE);
    unwrap(await registryUseCases(core).releaseShip(argo, { shipId: scoutId }));
    const next = crewAboard(core, { fleetId, shipId: scoutId });
    pushed(next);

    await after(10 * MINUTE);

    expect(overdueEvents().map((event) => [event.deliveryId, event.details.leaseId])).toEqual([
      [deliveryId, scout.leaseId],
      [deliveryId, next.leaseId],
    ]);
  });

  it('never runs for a person ship: a person away is not stuck (interop 5.1)', async () => {
    const { shipId: thomasId } = unwrap(
      await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }),
    );
    const thomas = crewAboard(core, { fleetId, shipId: thomasId });
    pushed(thomas);
    const deliveryId = await sendTo({ kind: 'ship', shipId: thomasId });
    unwrap(await useCases.pushReceiveDeliveries(thomas, {}));
    unwrap(await useCases.handOverDelivery(thomas, { deliveryId, handOverNumber: 1 }));

    await after(120 * MINUTE);

    expect(overdueEvents()).toEqual([]);
  });

  it('tells of each ship apart', async () => {
    const { shipId: lookoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'scribe' }));
    const lookout = crewAboard(core, { fleetId, shipId: lookoutId });
    pushed();
    pushed(lookout);
    await sendTo();
    await sendTo({ kind: 'ship', shipId: lookoutId });

    await after(10 * MINUTE);

    expect(new Set(overdueEvents().map((event) => event.shipId))).toEqual(new Set([scoutId, lookoutId]));
  });
});
