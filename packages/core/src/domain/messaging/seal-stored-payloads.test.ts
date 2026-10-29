import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { createSealStoredPayloads } from './seal-stored-payloads.js';
import { isSealedPayload } from './sealed-payload.js';

/**
 * The sealing pass (decision 0068, B5): scout sent chief messages and
 * scheduled check-ins while the fleet was not sealed; then the fleet manager
 * turned sealing on. The 30 second pass seals what the fleet stored plain.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let scout: ShipCaller;
let chief: Crew;

/** A payload with bytes past ASCII, so it comes back exactly or not at all. */
const PAYLOAD = 'Review the café figures before 5 €';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  chief = crewAboard(core, await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: [] }));
});

async function plainHistory(counts: { messages: number; schedules: number }): Promise<void> {
  for (let index = 0; index < counts.messages; index += 1) {
    unwrap(await messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'chief' }, payload: `${PAYLOAD} #${index}`, contentType: 'text/plain', model: SESSION_MODEL, idempotencyKey: newKey() }));
  }
  for (let index = 0; index < counts.schedules; index += 1) {
    unwrap(
      await messaging.scheduleMessage(scout, {
        selector: { kind: 'ship', name: 'chief' },
        payload: `${PAYLOAD} at ${index}`,
        model: SESSION_MODEL,
        idempotencyKey: newKey(),
        timing: { kind: 'once', at: new Date(`2026-11-0${1 + (index % 9)}T10:00:00.000Z`) },
      }),
    );
  }
}

function aPass(options: { batch?: number; budgetMs?: number } = {}) {
  return createSealStoredPayloads({ sealings: core.sealings, uow: core.uow, clock: core.clock, ids: core.ids, sealing: core.sealing, ...options });
}

function plainPayloads() {
  return [
    ...core.state.messages.filter((message) => message.fleetId === fleetId && !isSealedPayload(message.payload)),
    ...core.state.schedules.filter((schedule) => schedule.fleetId === fleetId && !isSealedPayload(schedule.send.payload)),
  ];
}

function sealedEvents() {
  return core.state.events.filter((event) => event.fleetId === fleetId && event.type === 'FleetPayloadsSealed');
}

function stateOf() {
  return core.state.fleetSealings.find((sealing) => sealing.fleetId === fleetId)?.state;
}

describe('the sealing pass (decision 0068, B5)', () => {
  it('scenario 5: given a fleet with a thousand plain messages and ten schedules, when it turns sealing on, then the sealing pass seals every one in batches, FleetPayloadsSealed is written once, and the database holds no plain payload of the fleet', async () => {
    await plainHistory({ messages: 1000, schedules: 10 });
    await sealFleet(core, fleetId);
    const sealing = stateOf();

    await aPass({ batch: 100 })();
    await aPass({ batch: 100 })();

    expect(sealing).toBe('sealing');
    expect(plainPayloads()).toEqual([]);
    expect(JSON.stringify(core.state.messages)).not.toContain('café');
    expect(JSON.stringify(core.state.schedules)).not.toContain('café');
    expect(stateOf()).toBe('sealed');
    expect(sealedEvents().map(({ actor }) => actor)).toEqual([{ kind: 'system' }]);
    const { deliveries } = unwrap(await messaging.receiveDeliveries(chief, { max: 1 }));
    expect(deliveries.map(({ payload }) => payload)).toEqual([`${PAYLOAD} #0`]);
  });

  it('keeps each plain byte count as it was', async () => {
    await plainHistory({ messages: 1, schedules: 1 });
    await sealFleet(core, fleetId);

    await aPass()();

    expect(core.state.messages.map((message) => message.payload)).toEqual([expect.objectContaining({ plainBytes: 40 })]);
    expect(core.state.schedules.map((schedule) => schedule.send.payload)).toEqual([expect.objectContaining({ plainBytes: 42 })]);
  });

  it('seals one batch a pass once its time budget is spent, and the fleet reads sealing until none is left', async () => {
    await plainHistory({ messages: 5, schedules: 0 });
    await sealFleet(core, fleetId);

    await aPass({ batch: 2, budgetMs: 0 })();
    const afterOne = { plain: plainPayloads().length, state: stateOf(), events: sealedEvents().length };
    await aPass({ batch: 2, budgetMs: 0 })();
    await aPass({ batch: 2, budgetMs: 0 })();

    expect(afterOne).toEqual({ plain: 3, state: 'sealing', events: 0 });
    expect({ plain: plainPayloads().length, state: stateOf(), events: sealedEvents().length }).toEqual({ plain: 0, state: 'sealed', events: 1 });
  });

  it('waits while the company key is cut off, sealing nothing, and seals on the first pass after it is restored', async () => {
    await plainHistory({ messages: 3, schedules: 1 });
    const companyKey = await sealFleet(core, fleetId);
    await core.keyVault.disable(companyKey);

    await aPass()();
    const whileCutOff = { plain: plainPayloads().length, state: stateOf(), events: sealedEvents().length };
    await core.keyVault.enable(companyKey);
    await aPass()();

    expect(whileCutOff).toEqual({ plain: 4, state: 'sealing', events: 0 });
    expect({ plain: plainPayloads().length, state: stateOf(), events: sealedEvents().length }).toEqual({ plain: 0, state: 'sealed', events: 1 });
  });

  it('skips a fleet whose sealing another server holds, and a message another transaction holds, until a later pass', async () => {
    await plainHistory({ messages: 3, schedules: 0 });
    await sealFleet(core, fleetId);
    const [held] = core.state.messages;
    core.state.sealingLocks.push(fleetId);

    await aPass()();
    const whileFleetHeld = plainPayloads().length;
    core.state.sealingLocks.length = 0;
    core.state.lockedMessages.push(held?.id ?? core.ids('message'));
    await aPass()();
    const whileMessageHeld = { plain: plainPayloads().map(({ id }) => id), state: stateOf(), events: sealedEvents().length };
    core.state.lockedMessages.length = 0;
    await aPass()();

    expect(whileFleetHeld).toBe(3);
    expect(whileMessageHeld).toEqual({ plain: [held?.id], state: 'sealing', events: 0 });
    expect({ plain: plainPayloads().length, state: stateOf(), events: sealedEvents().length }).toEqual({ plain: 0, state: 'sealed', events: 1 });
  });

  it('leaves a fleet that is not sealed as it is, its payloads plain', async () => {
    await plainHistory({ messages: 2, schedules: 1 });

    await aPass()();

    expect(plainPayloads()).toHaveLength(3);
    expect(sealedEvents()).toEqual([]);
  });
});
