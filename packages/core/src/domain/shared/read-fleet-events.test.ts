import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from './caller.js';
import { ok } from './result.js';
import { SYSTEM, recordEvent } from './events.js';
import { createReadFleetEvents, REPLAY_LIMIT, type ReadFleetEvents } from './read-fleet-events.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let readFleetEvents: ReadFleetEvents;

beforeEach(async () => {
  core = createInMemoryCore();
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  readFleetEvents = createReadFleetEvents({ feed: core.feed });
});

/** Appends this many events to the fleet, each in its own unit of work. */
async function appendEvents(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await core.uow.run(async (tx) => {
      await recordEvent(
        { events: tx.events, ids: core.ids },
        { fleetId, type: 'StartingPromptIssued', occurredAt: core.clock.now(), actor: SYSTEM },
      );
      return ok(undefined);
    });
  }
}

function eventCount(): number {
  return core.state.events.filter((event) => event.fleetId === fleetId).length;
}

describe('reading the fleet events', () => {
  it('tells a browser without a position to load the fleet and follow from the last number', async () => {
    await expect(readFleetEvents(argo, undefined)).resolves.toEqual({ kind: 'resync', seq: eventCount() });
  });

  it('gives the events after the position, oldest first, each with its number', async () => {
    const position = eventCount();
    unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    const read = await readFleetEvents(argo, position);

    expect(read).toEqual({
      kind: 'events',
      events: core.state.events.slice(position).map((event, index) => ({ ...event, seq: position + index + 1 })),
    });
  });

  it('gives no events to a browser that is up to date', async () => {
    await expect(readFleetEvents(argo, eventCount())).resolves.toEqual({ kind: 'events', events: [] });
  });

  it(`replays up to ${String(REPLAY_LIMIT)} missed events`, async () => {
    const position = eventCount();
    await appendEvents(REPLAY_LIMIT);

    const read = await readFleetEvents(argo, position);

    expect(read.kind === 'events' && read.events.length).toBe(REPLAY_LIMIT);
  });

  it(`tells a browser more than ${String(REPLAY_LIMIT)} events behind to load the fleet again and follow from the last number`, async () => {
    const position = eventCount();
    await appendEvents(REPLAY_LIMIT + 1);

    await expect(readFleetEvents(argo, position)).resolves.toEqual({ kind: 'resync', seq: eventCount() });
  });

  it("reads only the caller's fleet", async () => {
    const elsewhere = { ...argo, fleetId: core.ids('fleet') };

    await expect(readFleetEvents(elsewhere, 0)).resolves.toEqual({ kind: 'events', events: [] });
  });
});
