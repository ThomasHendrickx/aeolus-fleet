import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  historyUseCases,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  modelOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Crew } from './caller.js';
import { newKey } from '../../../test/support/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let history: ReturnType<typeof historyUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Crew;
let captain: Crew;
let tester: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  const registry = registryUseCases(core);
  const operator = operatorCaller(fleet);
  captain = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'release-captain', type: 'release' })).shipId });
  tester = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operator, { idempotencyKey: newKey(), name: 'tester-01', type: 'tester' })).shipId });
  argo = await argoAboard(core);
  messaging = messagingUseCases(core);
  history = historyUseCases(core);
});

async function toArgo(from: Crew, payload: string): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  core.clock.advance(60_000);
  const { messageId } = unwrap(
    await messaging.sendMessage(from, { ...modelOf(from), selector: { kind: 'ship', shipId: argoId }, payload, idempotencyKey: payload }),
  );
  const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
  return { messageId, deliveryId: delivery?.id ?? core.ids('delivery') };
}

describe("reading argo's inbox", () => {
  it('lists the open messages to argo, newest first, unread, each with its sender and whole payload', async () => {
    const older = await toArgo(tester, 'checkout-e2e failed 3 of 5 runs since 12:00.');
    const newer = await toArgo(captain, 'Release 2.14 is staged. Promote to production?');

    const inbox = await history.readInbox(argo, { filter: 'open' });

    expect(inbox.map((entry) => entry.message.id)).toEqual([newer.messageId, older.messageId]);
    expect(inbox[0]).toEqual({
      deliveryId: newer.deliveryId,
      state: 'pending',
      readAt: null,
      doneAt: null,
      repliedWith: null,
      replies: [],
      message: {
        id: newer.messageId,
        sender: { id: captain.shipId, name: 'release-captain' },
        inReplyTo: null,
        sentAt: core.clock.now(),
        contentType: 'text/plain',
        model: 'claude-opus-5-5',
        payload: 'Release 2.14 is staged. Promote to production?',
      },
    });
  });

  it('keeps open and done apart, and lists both under all', async () => {
    const open = await toArgo(tester, 'still open');
    const done = await toArgo(captain, 'done now');
    unwrap(await messaging.markDone(argo, { deliveryId: done.deliveryId }));

    const ids = async (filter: 'open' | 'done' | 'all') =>
      (await history.readInbox(argo, { filter })).map((entry) => entry.message.id);

    await expect(ids('open')).resolves.toEqual([open.messageId]);
    await expect(ids('done')).resolves.toEqual([done.messageId]);
    await expect(ids('all')).resolves.toEqual([done.messageId, open.messageId]);
  });

  it('says when a message was read, and when and by which reply it was done', async () => {
    const asked = await toArgo(captain, 'Promote?');
    core.clock.advance(60_000);
    unwrap(await messaging.markRead(argo, { deliveryId: asked.deliveryId, isRead: true }));
    const readAt = core.clock.now();
    core.clock.advance(60_000);
    const { messageId: reply } = unwrap(
      await messaging.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }),
    );

    const [entry] = await history.readInbox(argo, { filter: 'done' });

    expect(entry).toMatchObject({ state: 'acknowledged', readAt, doneAt: core.clock.now(), repliedWith: reply });
  });

  it("lists argo's own replies to a message, oldest first, each with its content type and payload", async () => {
    const asked = await toArgo(captain, 'Promote?');
    core.clock.advance(60_000);
    const { messageId: first } = unwrap(
      await messaging.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }),
    );
    const firstAt = core.clock.now();
    core.clock.advance(60_000);
    const { messageId: second } = unwrap(
      await messaging.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'and thanks', idempotencyKey: 'thanks' }),
    );

    const [entry] = await history.readInbox(argo, { filter: 'all' });

    expect(entry?.replies).toEqual([
      { id: first, contentType: 'text/plain', payload: 'go', sentAt: firstAt },
      { id: second, contentType: 'text/plain', payload: 'and thanks', sentAt: core.clock.now() },
    ]);
  });

  it('counts only replies argo sent, not those of other ships naming the message', async () => {
    const asked = await toArgo(captain, 'Promote?');
    unwrap(
      await messaging.sendMessage(tester, {
        ...modelOf(tester),
        selector: { kind: 'ship', shipId: captain.shipId },
        payload: 'not yet',
        inReplyTo: asked.messageId,
        idempotencyKey: 'not-yet',
      }),
    );

    const [entry] = await history.readInbox(argo, { filter: 'all' });

    expect(entry?.replies).toEqual([]);
  });

  it('leaves out messages argo sent, and messages to other ships', async () => {
    unwrap(await messaging.sendMessage(argo, { selector: { kind: 'ship', shipId: captain.shipId }, payload: 'go', idempotencyKey: 'go' }));
    unwrap(await messaging.sendMessage(tester, { ...modelOf(tester), selector: { kind: 'ship', shipId: captain.shipId }, payload: 'hi', idempotencyKey: 'hi' }));

    await expect(history.readInbox(argo, { filter: 'all' })).resolves.toEqual([]);
  });

  it("knows nothing of another fleet's inbox", async () => {
    await toArgo(captain, 'Promote?');

    await expect(history.readInbox({ ...argo, fleetId: core.ids('fleet') }, { filter: 'all' })).resolves.toEqual([]);
  });
});

describe("a viewer reading argo's inbox", () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it("reads argo's inbox while viewer reading is on", async () => {
    const asked = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });

    const inbox = await fleet.history.readInbox(fleet.viewer, { filter: 'all' });

    expect(inbox.map((entry) => entry.message.id)).toEqual([asked]);
  });

  it('reads no message of it once argo turns viewer reading off', async () => {
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    unwrap(await fleet.registry.setBuiltInRule(fleet.argo, { rule: 'viewerRead', isOn: false }));

    await expect(fleet.history.readInbox(fleet.viewer, { filter: 'all' })).resolves.toEqual([]);
  });
});
