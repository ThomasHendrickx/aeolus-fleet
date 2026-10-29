import type { ScheduleId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSchedule } from './schedule-message.js';

/**
 * A schedule in a sealed fleet (decision 0068, B7, B17): scout schedules a
 * check-in to chief for 10:00, made at 09:00. Its payload is stored sealed,
 * bound to the schedule, and each message it sends is sealed for its own id.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let scout: ShipCaller;
let chief: ShipCaller;

const SEND_TIME = '2026-10-29T10:00:00.000Z';
/** A payload with bytes past ASCII, so it comes back exactly or not at all. */
const PAYLOAD = 'Check in: what changed at the café since 5 €?';

function aSchedule(overrides: Partial<MessageToSchedule> = {}): MessageToSchedule {
  return { selector: { kind: 'ship', name: 'chief' }, payload: PAYLOAD, model: SESSION_MODEL, idempotencyKey: newKey(), timing: { kind: 'once', at: new Date(SEND_TIME) }, ...overrides };
}

function scheduleOf(scheduleId: ScheduleId) {
  return core.state.schedules.find((schedule) => schedule.id === scheduleId);
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] });
  await sealFleet(core, fleet.fleetId);
});

describe('a schedule in a sealed fleet (decision 0068, B7, B17)', () => {
  it('stores its payload sealed under the current data key with its plain byte count, and no plain payload', async () => {
    const { scheduleId } = unwrap(await messaging.scheduleMessage(scout, aSchedule()));

    const [currentKey] = core.state.dataKeys;
    expect(scheduleOf(scheduleId)?.send.payload).toMatchObject({ sealed: { dataKeyId: currentKey?.id }, plainBytes: 48 });
    expect(JSON.stringify(core.state.schedules)).not.toContain('café');
  });

  it('answers a repeat of the same request with its key with the original; with another payload it is refused as today', async () => {
    const first = aSchedule();
    const { scheduleId } = unwrap(await messaging.scheduleMessage(scout, first));

    const repeat = await messaging.scheduleMessage(scout, { ...first });
    const changed = await messaging.scheduleMessage(scout, { ...first, payload: 'Check in: what changed?' });

    expect(unwrap(repeat)).toEqual({ scheduleId });
    expect(refusalOf(changed).kind).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(core.state.schedules).toHaveLength(1);
  });

  it("leaves a sealed schedule's payload out of its request hash, so a copy confirms no guessed payload", async () => {
    const { scheduleId: one } = unwrap(await messaging.scheduleMessage(scout, aSchedule({ payload: 'yes' })));
    const { scheduleId: other } = unwrap(await messaging.scheduleMessage(scout, aSchedule({ payload: 'no' })));

    expect(scheduleOf(one)?.requestHash).toBe(scheduleOf(other)?.requestHash);
  });

  it('sends at its time a message sealed for its own id, and its recipient receives the payload as scheduled', async () => {
    const { scheduleId } = unwrap(await messaging.scheduleMessage(scout, aSchedule()));
    core.clock.set(SEND_TIME);

    await messaging.sendDueSchedules();

    const [message] = core.state.messages;
    expect(message?.payload).toMatchObject({ plainBytes: 48 });
    expect(message?.payload).not.toEqual(scheduleOf(scheduleId)?.send.payload);
    expect(JSON.stringify(core.state.messages)).not.toContain('café');
    const { deliveries } = unwrap(await messaging.receiveDeliveries(crewAboard(core, chief), {}));
    expect(deliveries.map(({ payload, scheduleId: from }) => ({ payload, from }))).toEqual([{ payload: PAYLOAD, from: scheduleId }]);
  });
});
