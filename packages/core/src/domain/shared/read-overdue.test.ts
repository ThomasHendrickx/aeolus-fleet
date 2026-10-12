import type { DeliveryId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';
import { createTellOverdueDeliveries } from '../messaging/tell-overdue-deliveries.js';
import type { Crew } from './caller.js';

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
  const { core } = scene;
  core.clock.advance(ms);
  await createTellOverdueDeliveries({ fleets: core.fleets, pushedCrews: core.pushedCrews, uow: core.uow, clock: core.clock, ids: core.ids })();
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
