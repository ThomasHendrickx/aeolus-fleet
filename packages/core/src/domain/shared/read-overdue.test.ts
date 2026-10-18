import type { DeliveryId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from './caller.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

const MINUTE = 60_000;

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

/** The crew's computer side push receives the message and hands it over as number 1; answers its delivery. */
async function handed(crew: Crew, messageId: MessageId): Promise<DeliveryId> {
  const deliveryId = deliveryIdOf(scene.core, messageId);
  unwrap(await scene.messaging.pushReceiveDeliveries(crew, {}));
  unwrap(await scene.messaging.handOverDelivery(crew, { deliveryId, handOverNumber: 1 }));
  return deliveryId;
}

/** Moves the clock, then one pass of the clocks. */
async function after(ms: number): Promise<void> {
  scene.core.clock.advance(ms);
  await scene.messaging.tellOverdueDeliveries();
}

describe('reading the overdue deliveries', () => {
  it('lists a delivery argo was told is overdue, with its ship, its clock, when argo was told and its whole message', async () => {
    const payload = 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/48';
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId }, payload });
    const sentAt = scene.core.clock.now();
    const deliveryId = await handed(scene.scout, messageId);
    await after(10 * MINUTE);

    await expect(scene.history.readOverdue(scene.argo)).resolves.toEqual([
      {
        deliveryId,
        ship: { id: scene.scout.shipId, name: 'scout' },
        state: 'handed',
        clock: 'notConfirmed',
        minutes: 10,
        toldAt: scene.core.clock.now(),
        message: {
          id: messageId,
          sender: { id: scene.planner.shipId, name: 'planner' },
          recipient: { kind: 'ship', ship: { id: scene.scout.shipId, name: 'scout' } },
          inReplyTo: null,
          sentAt,
          contentType: 'text/plain',
          model: 'claude-opus-5-5',
          isPing: false,
          payload,
        },
      },
    ]);
  });

  it('lists nothing before a clock ran out', async () => {
    await handed(scene.scout, await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } }));
    await after(10 * MINUTE - 1);

    await expect(scene.history.readOverdue(scene.argo)).resolves.toEqual([]);
  });

  it('clears by itself once the delivery is confirmed', async () => {
    const deliveryId = await handed(scene.scout, await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } }));
    await after(10 * MINUTE);

    unwrap(await scene.messaging.acknowledgeDelivery(scene.scout, { deliveryId }));

    await expect(scene.history.readOverdue(scene.argo)).resolves.toEqual([]);
  });

  it('clears by itself once the lease ends', async () => {
    await handed(scene.scout, await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } }));
    await after(10 * MINUTE);

    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));

    await expect(scene.history.readOverdue(scene.argo)).resolves.toEqual([]);
  });

  it('lists them oldest told first', async () => {
    const toScout = await handed(scene.scout, await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } }));
    scene.core.clock.advance(MINUTE);
    const toLookout = await handed(scene.lookout, await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } }));
    await after(9 * MINUTE);
    await after(MINUTE);

    expect((await scene.history.readOverdue(scene.argo)).map((entry) => entry.deliveryId)).toEqual([toScout, toLookout]);
  });
});

describe('reading the overdue deliveries within read reach (decision 0034)', () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('lists only the deliveries whose message the caller reads', async () => {
    const toNear = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.near.shipId });
    const toFar = await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.far.shipId });
    for (const [crew, messageId] of [
      [fleet.near, toNear],
      [fleet.far, toFar],
    ] as const) {
      const deliveryId = deliveryIdOf(fleet.core, messageId);
      unwrap(await fleet.messaging.pushReceiveDeliveries(crew, {}));
      unwrap(await fleet.messaging.handOverDelivery(crew, { deliveryId, handOverNumber: 1 }));
    }
    fleet.core.clock.advance(11 * MINUTE);
    await fleet.messaging.tellOverdueDeliveries();

    const [read, all] = [await fleet.history.readOverdue(fleet.reader), await fleet.history.readOverdue(fleet.argo)];

    expect([read.map((entry) => entry.message.id), all.length]).toEqual([[toNear], 2]);
  });
});
