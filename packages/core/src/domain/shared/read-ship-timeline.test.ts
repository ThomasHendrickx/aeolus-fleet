import { accountIdSchema, PAGE_SIZE_DEFAULT } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../testing/result.js';
import { SYSTEM, recordEvent } from './events.js';
import { ok } from './result.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

async function timelineOf(shipId = scene.scout.shipId) {
  return unwrap(await scene.history.readShipTimeline(scene.argo, { shipId })).items;
}

/** Records events naming the scout, as many as asked. */
async function issueStartingPrompts(count: number) {
  for (let index = 0; index < count; index += 1) {
    await scene.core.uow.run(async (tx) => {
      await recordEvent(
        { events: tx.events, ids: scene.core.ids },
        { fleetId: scene.fleetId, type: 'StartingPromptIssued', occurredAt: scene.core.clock.now(), actor: SYSTEM, shipId: scene.scout.shipId },
      );
      return ok(undefined);
    });
  }
}

describe("reading a ship's timeline", () => {
  it('gives the events that name the ship or that it caused, newest first, each with its number', async () => {
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });

    const timeline = await timelineOf();

    expect(timeline.map((entry) => entry.type)).toEqual(['MessageAccepted', 'StartingPromptIssued', 'OwnerSet', 'ShipCommissioned']);
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
        contentType: 'text/plain',
        isPing: false,
      },
    });
  });

  it('tells a ping by its message', async () => {
    const { messageId } = unwrap(await scene.messaging.pingShip(scene.argo, { shipId: scene.scout.shipId }));

    const [pinged] = await timelineOf(scene.scout.shipId);

    expect(pinged?.message).toMatchObject({ id: messageId, isPing: true });
  });

  it('shows a message to a type on the page of the ship that sent it', async () => {
    await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });

    const [sent] = await timelineOf(scene.planner.shipId);

    expect(sent).toMatchObject({ ship: null, message: { recipient: { kind: 'type', type: 'reviewer' } } });
  });

  it('names the account signed in as argo when argo caused it, by its id', async () => {
    const signedInAccountId = accountIdSchema.parse('acc-01mathilde');
    unwrap(await scene.messaging.pingShip({ ...scene.argo, signedInAccountId }, { shipId: scene.scout.shipId }));

    const [pinged] = await timelineOf(scene.scout.shipId);

    expect(pinged).toMatchObject({ actor: { name: 'argo' }, signedInAccountId: 'acc-01mathilde' });
  });

  it("names no signed-in account for argo's own sign-in or another ship", async () => {
    unwrap(await scene.messaging.pingShip(scene.argo, { shipId: scene.scout.shipId }));
    await scene.send(scene.scout, { to: { kind: 'ship', shipId: scene.planner.shipId } });

    const [sent, pinged] = await timelineOf(scene.scout.shipId);

    expect([sent?.signedInAccountId, pinged?.signedInAccountId]).toEqual([null, null]);
  });

  it('names no actor for what the system did', async () => {
    const timeline = await timelineOf(scene.argo.shipId);

    expect(timeline.at(-1)).toMatchObject({ type: 'ShipCommissioned', actor: null, ship: { name: 'argo' } });
  });

  it('answers a page of at most the limit, newest first, with the cursor of its last event', async () => {
    const whole = await timelineOf();

    const page = unwrap(await scene.history.readShipTimeline(scene.argo, { shipId: scene.scout.shipId, limit: 2 }));

    expect(page.items.map((entry) => entry.id)).toEqual(whole.slice(0, 2).map((entry) => entry.id));
    expect(page.nextCursor).toBe(whole[1]?.id);
  });

  it('answers the events older than the cursor on the next page, and no cursor after the last', async () => {
    await issueStartingPrompts(1);
    const whole = await timelineOf();
    const first = unwrap(await scene.history.readShipTimeline(scene.argo, { shipId: scene.scout.shipId, limit: 3 }));

    const next = unwrap(await scene.history.readShipTimeline(scene.argo, { shipId: scene.scout.shipId, limit: 3, cursor: first.nextCursor ?? undefined }));

    expect(next.items.map((entry) => entry.id)).toEqual(whole.slice(3).map((entry) => entry.id));
    expect(next.nextCursor).toBeNull();
  });

  it('answers no cursor when the page holds exactly the last events', async () => {
    const whole = await timelineOf();

    const page = unwrap(await scene.history.readShipTimeline(scene.argo, { shipId: scene.scout.shipId, limit: whole.length }));

    expect([page.items.length, page.nextCursor]).toEqual([whole.length, null]);
  });

  it(`answers ${String(PAGE_SIZE_DEFAULT)} events unless told fewer`, async () => {
    await issueStartingPrompts(PAGE_SIZE_DEFAULT);

    const timeline = await timelineOf();

    expect(timeline).toHaveLength(PAGE_SIZE_DEFAULT);
  });

  it('knows no ship of another fleet', async () => {
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readShipTimeline(elsewhere, { shipId: scene.scout.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});

describe("reading the timeline of a ship outside read reach (decision 0034)", () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('gives only the events of the messages it reads, none about the ship itself', async () => {
    const withNear = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });

    const timeline = unwrap(await fleet.history.readShipTimeline(fleet.reader, { shipId: fleet.far.shipId })).items;

    expect(new Set(timeline.map((entry) => entry.message?.id ?? null))).toEqual(new Set([withNear]));
  });

  it('pages past the events it leaves out: a page can come short, with the cursor of the last event it read', async () => {
    const withNear = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    const first = unwrap(await fleet.history.readShipTimeline(fleet.reader, { shipId: fleet.far.shipId, limit: 1 }));

    const next = unwrap(await fleet.history.readShipTimeline(fleet.reader, { shipId: fleet.far.shipId, limit: 1, cursor: first.nextCursor ?? undefined }));

    expect([first.items.length, next.items.map((entry) => entry.message?.id)]).toEqual([0, [withNear]]);
  });

  it("gives argo every event of the ship's timeline", async () => {
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });

    const timeline = unwrap(await fleet.history.readShipTimeline(fleet.argo, { shipId: fleet.far.shipId })).items;

    expect(timeline.some((entry) => entry.message === null)).toBe(true);
  });
});
