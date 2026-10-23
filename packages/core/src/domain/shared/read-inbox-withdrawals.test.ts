import { QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { argoAboard, crewAboard, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from './caller.js';

const QUESTION_ID = '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47';
const OTHER_QUESTION_ID = '5c8e1a3b-6d2f-4b7a-9e0c-3a5d7f9b1c2e';
const REPLACEMENT = { id: '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f', title: 'Which port, now?', context: '', options: [{ key: 1, label: 'Keep 3000' }], pick: { option: 1, why: 'Fewest changes.' } };

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let history: ReturnType<typeof historyUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  const registry = registryUseCases(core);
  captain = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'release-captain', type: 'release' })).shipId });
  argo = await argoAboard(core);
  messaging = messagingUseCases(core);
  history = historyUseCases(core);
});

async function send({ to = argoId, contentType, payload }: { to?: ShipId; contentType: string; payload: unknown }): Promise<DeliveryId> {
  core.clock.advance(60_000);
  const { messageId } = unwrap(
    await messaging.sendMessage(captain, { ...modelOf(captain), selector: { kind: 'ship', shipId: to }, contentType, payload: JSON.stringify(payload), idempotencyKey: newKey() }),
  );
  return core.state.deliveries.find((held) => held.messageId === messageId)?.id ?? core.ids('delivery');
}

const ids = (page: { items: { deliveryId: DeliveryId }[] }) => page.items.map(({ deliveryId }) => deliveryId);

describe("reading a question's withdrawals in argo's inbox", () => {
  it('lists the withdrawals and replacements to argo naming the question, oldest first, as the inbox lists them', async () => {
    await send({ contentType: QUESTION_CONTENT_TYPE, payload: { id: QUESTION_ID } });
    const withdrawal = await send({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: QUESTION_ID } });
    await send({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: OTHER_QUESTION_ID } });
    await send({ contentType: 'text/plain', payload: { questionId: QUESTION_ID } });
    await send({ to: captain.shipId, contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: QUESTION_ID } });
    const replacement = await send({ contentType: `${REPLACEMENT_CONTENT_TYPE}; charset=utf-8`, payload: { questionId: QUESTION_ID, question: REPLACEMENT } });
    const listed = (await history.readInbox(argo, { filter: 'all' })).items;

    const withdrawals = await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID });

    expect(ids(withdrawals)).toEqual([withdrawal, replacement]);
    expect(withdrawals.items[0]).toEqual(listed.find((entry) => entry.deliveryId === withdrawal));
  });

  it('answers a page at a time, each after the cursor of the last', async () => {
    const first = await send({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: QUESTION_ID } });
    const second = await send({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: QUESTION_ID } });
    const third = await send({ contentType: WITHDRAWAL_CONTENT_TYPE, payload: { questionId: QUESTION_ID } });

    const page = await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID, limit: 2 });
    const next = await history.readInboxWithdrawals(argo, { questionId: QUESTION_ID, limit: 2, cursor: page.nextCursor ?? undefined });

    expect([ids(page), page.nextCursor]).toEqual([[first, second], second]);
    expect([ids(next), next.nextCursor]).toEqual([[third], null]);
  });

  it('lists none for a question nobody withdrew', async () => {
    await send({ contentType: QUESTION_CONTENT_TYPE, payload: { id: QUESTION_ID } });

    await expect(history.readInboxWithdrawals(argo, { questionId: QUESTION_ID })).resolves.toEqual({ items: [], nextCursor: null });
  });
});

describe("a viewer reading a question's withdrawals", () => {
  it('reads none once argo turns viewer reading off', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    unwrap(
      await fleet.messaging.sendMessage(fleet.far, {
        ...modelOf(fleet.far),
        selector: { kind: 'ship', shipId: fleet.argo.shipId },
        contentType: WITHDRAWAL_CONTENT_TYPE,
        payload: JSON.stringify({ questionId: QUESTION_ID }),
        idempotencyKey: newKey(),
      }),
    );

    await expect(fleet.history.readInboxWithdrawals(fleet.viewer, { questionId: QUESTION_ID }).then(({ items }) => items.length)).resolves.toBe(1);
    unwrap(await fleet.registry.setBuiltInRule(fleet.argo, { rule: 'viewerRead', isOn: false }));
    await expect(fleet.history.readInboxWithdrawals(fleet.viewer, { questionId: QUESTION_ID })).resolves.toEqual({ items: [], nextCursor: null });
  });
});
