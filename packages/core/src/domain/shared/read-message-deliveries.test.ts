import { beforeEach, describe, expect, it } from 'vitest';

import type { MessageId } from '@aeolus-fleet/common';

import { deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { Crew } from './caller.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

describe("reading a page of a message's deliveries", () => {
  const sendToTeam = async (crews: readonly Crew[]): Promise<MessageId> => {
    unwrap(await scene.registry.defineLabel(scene.argo, { key: 'team', values: ['a'] }));
    const teamA = valueIdOf(scene.core, { key: 'team', value: 'a' });
    for (const crew of crews) {
      unwrap(await scene.registry.assignLabel(scene.argo, { shipId: crew.shipId, valueId: teamA }));
    }
    return scene.send(scene.argo, { to: { kind: 'label', valueIds: [teamA] } });
  };
  const deliveryTo = (messageId: MessageId, crew: Crew) =>
    scene.core.state.deliveries.find((held) => held.messageId === messageId && held.recipient.kind === 'ship' && held.recipient.shipId === crew.shipId)?.id;

  it('gives a message to one ship its one delivery, with its ship, state and since when', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const sentAt = scene.core.clock.now();

    expect(unwrap(await scene.history.readMessageDeliveries(scene.argo, { messageId }))).toEqual({
      items: [{ id: deliveryIdOf(scene.core, messageId), ship: { id: scene.scout.shipId, name: 'scout' }, state: 'pending', since: sentAt, progress: null }],
      nextCursor: null,
    });
  });

  it('gives every delivery of a send to a label by id, each with its ship, state and since when (decision 0065)', async () => {
    const messageId = await sendToTeam([scene.scout, scene.lookout, scene.planner]);
    const sentAt = scene.core.clock.now();
    await scene.receive(scene.lookout);
    const handedAt = scene.core.clock.now();
    await scene.receive(scene.planner);
    await scene.ack(scene.planner, messageId);
    const ackedAt = scene.core.clock.now();

    expect(unwrap(await scene.history.readMessageDeliveries(scene.argo, { messageId })).items).toEqual(
      [
        { id: deliveryTo(messageId, scene.scout), ship: { id: scene.scout.shipId, name: 'scout' }, state: 'pending', since: sentAt, progress: null },
        { id: deliveryTo(messageId, scene.lookout), ship: { id: scene.lookout.shipId, name: 'lookout' }, state: 'handed', since: handedAt, progress: null },
        { id: deliveryTo(messageId, scene.planner), ship: { id: scene.planner.shipId, name: 'planner' }, state: 'acknowledged', since: ackedAt, progress: null },
      ].toSorted((first, second) => String(first.id).localeCompare(String(second.id))),
    );
  });

  it('pages them by id, the next page after the cursor the last one answered', async () => {
    const messageId = await sendToTeam([scene.scout, scene.lookout, scene.planner]);
    const ids = [scene.scout, scene.lookout, scene.planner].map((crew) => String(deliveryTo(messageId, crew))).toSorted();

    const first = unwrap(await scene.history.readMessageDeliveries(scene.argo, { messageId, limit: 2 }));
    const second = unwrap(await scene.history.readMessageDeliveries(scene.argo, { messageId, limit: 2, ...(first.nextCursor ? { cursor: first.nextCursor } : {}) }));

    expect([first.items.map((delivery) => delivery.id), first.nextCursor, second.items.map((delivery) => delivery.id), second.nextCursor]).toEqual([
      ids.slice(0, 2),
      ids[1],
      ids.slice(2),
      null,
    ]);
  });

  it('shows progress only for recipients whose task is exactly this message', async () => {
    // Given a message to three recipients, only one working on exactly that task.
    const messageId = await sendToTeam([scene.scout, scene.lookout, scene.planner]);
    const task = { kind: 'message', fleetId: scene.fleetId, messageId };
    unwrap(await scene.registry.report(scene.scout, { state: 'working', note: 'Drafting the guide', task, step: { at: 1, of: 4 } }));
    unwrap(await scene.registry.report(scene.lookout, { state: 'working', task: { ...task, fleetId: scene.core.ids('fleet') } }));
    unwrap(await scene.registry.report(scene.planner, { state: 'working', task: { ...task, extra: true } }));

    // When the sender opens the deliveries.
    const page = unwrap(await scene.history.readMessageDeliveries(scene.argo, { messageId }));

    // Then only the matching recipient shows its current report.
    expect(page.items.find(({ ship }) => ship?.id === scene.scout.shipId)).toMatchObject({
      progress: { state: 'working', note: 'Drafting the guide', step: { at: 1, of: 4 }, reportChangedAt: scene.core.clock.now() },
    });
    expect(page.items.filter(({ ship }) => ship?.id !== scene.scout.shipId).map((delivery) => delivery.progress)).toEqual([null, null]);
  });

  it('knows no message of another fleet', async () => {
    const messageId = await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    expect(refusalOf(await scene.history.readMessageDeliveries(elsewhere, { messageId }))).toMatchObject({ kind: 'MESSAGE_NOT_FOUND' });
  });
});

describe("reading a message's deliveries within read reach (decision 0034)", () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('keeps a recipient report outside the viewer read reach private even when the message is readable', async () => {
    // Given a readable sender and a recipient outside the viewer's reach.
    const messageId = await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.far.shipId });
    unwrap(await fleet.registry.report(fleet.far, { state: 'working', note: 'Private report', task: { kind: 'message', fleetId: fleet.fleetId, messageId } }));

    // When the viewer reads the message and its deliveries through the sender.
    const message = unwrap(await fleet.history.readMessage(fleet.reader, { messageId }));
    const deliveries = unwrap(await fleet.history.readMessageDeliveries(fleet.reader, { messageId }));

    // Then neither read reveals the recipient's report.
    expect(message.progress).toBeNull();
    expect(deliveries.items[0]?.progress).toBeNull();
  });

  it('reads the deliveries of a message through its sender', async () => {
    const messageId = await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.far.shipId });

    expect(unwrap(await fleet.history.readMessageDeliveries(fleet.reader, { messageId })).items).toHaveLength(1);
  });

  it('answers a message between ships outside its read reach as no message, so its existence does not show', async () => {
    const messageId = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });

    expect(refusalOf(await fleet.history.readMessageDeliveries(fleet.reader, { messageId }))).toEqual({ kind: 'MESSAGE_NOT_FOUND', message: `No message ${messageId} in this fleet` });
  });
});
