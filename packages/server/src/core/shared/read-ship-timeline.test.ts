import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../../test/support/result.js';
import { SYSTEM, recordEvent } from './events.js';
import { TIMELINE_LIMIT } from './read-ship-timeline.js';
import { ok } from './result.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function timelineOf(shipId = scene.scout.shipId) {
  return unwrap(await scene.history.readShipTimeline(scene.argo, { shipId }));
}

describe("reading a ship's timeline", () => {
  it('gives the events that name the ship or that it caused, newest first, each with its number', async () => {
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });

    const timeline = await timelineOf();

    expect(timeline.map((entry) => entry.type)).toEqual(['MessageAccepted', 'StartingPromptIssued', 'ShipCommissioned']);
    const numbers = timeline.map((entry) => entry.seq);
    expect(numbers).toEqual([...numbers].sort((first, second) => second - first));
  });

  it("leaves out other ships' events", async () => {
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });

    const timeline = await timelineOf();

    expect(timeline.every((entry) => entry.message === null)).toBe(true);
  });

  it('names who caused it, the ship it concerns, and the message with its sender and recipient', async () => {
    const messageId = await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });

    const [sent] = await timelineOf(scene.planner.shipId);

    expect(sent).toMatchObject({
      type: 'MessageAccepted',
      actor: { id: scene.scout.shipId, name: 'scout' },
      ship: { id: scene.planner.shipId, name: 'planner' },
      message: {
        id: messageId,
        sender: { id: scene.scout.shipId, name: 'scout' },
        recipient: { kind: 'ship', ship: { id: scene.planner.shipId, name: 'planner' } },
      },
    });
  });

  it('shows a message to a type on the page of the ship that sent it', async () => {
    await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });

    const [sent] = await timelineOf(scene.planner.shipId);

    expect(sent).toMatchObject({ ship: null, message: { recipient: { kind: 'type', type: 'reviewer' } } });
  });

  it('names no actor for what the system did', async () => {
    const timeline = await timelineOf(scene.argo.shipId);

    expect(timeline.at(-1)).toMatchObject({ type: 'ShipCommissioned', actor: null, ship: { name: 'argo' } });
  });

  it(`keeps the newest ${String(TIMELINE_LIMIT)}`, async () => {
    for (let index = 0; index < TIMELINE_LIMIT; index += 1) {
      await scene.core.uow.run(async (tx) => {
        await recordEvent(
          { events: tx.events, ids: scene.core.ids },
          { fleetId: scene.fleetId, type: 'StartingPromptIssued', occurredAt: scene.core.clock.now(), actor: SYSTEM, shipId: scene.scout.shipId },
        );
        return ok(undefined);
      });
    }

    const timeline = await timelineOf();

    expect(timeline).toHaveLength(TIMELINE_LIMIT);
    expect(timeline.at(-1)?.type).toBe('StartingPromptIssued');
  });

  it('knows no ship of another fleet', async () => {
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readShipTimeline(elsewhere, { shipId: scene.scout.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});
