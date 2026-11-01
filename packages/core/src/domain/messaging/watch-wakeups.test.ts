import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import type { WakeStreamItem } from './watch-wakeups.js';

// The wake stream (long-poll design, W1): a crew keeps it open and is told
// "look now"; it never carries a delivery. The hub that routes each notice
// to its ship and type is tested at its adapter (receiver-wakeups.test.ts).

/** The time between two keep-alives while no wake comes. */
const KEEP_ALIVE_MS = 25_000;

let core: InMemoryCore;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;
let useCases: ReturnType<typeof messagingUseCases>;
let closing: AbortController;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-01T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  closing = new AbortController();
});

async function open(crew: Crew = scout): Promise<AsyncIterator<WakeStreamItem>> {
  return unwrap(await useCases.watchWakeups(crew, closing.signal))[Symbol.asyncIterator]();
}

/** The stream's next item, or done when it closed. */
async function nextOf(stream: AsyncIterator<WakeStreamItem>): Promise<WakeStreamItem | 'closed'> {
  const next = await stream.next();
  return next.done === true ? 'closed' : next.value;
}

describe('opening the wake stream', () => {
  it('watches the ship and its type before it sends the first wake, reason open', async () => {
    const stream = await open();

    expect(core.wakeStreams.opened).toEqual([{ fleetId, shipId: scoutId, type: 'reviewer' }]);
    await expect(nextOf(stream)).resolves.toEqual({ kind: 'wake', reason: 'open' });
  });

  it('is refused LEASE_ENDED without a held lease, and watches nothing', async () => {
    unwrap(await registryUseCases(core).releaseShip(argo, { shipId: scoutId }));

    const opened = await useCases.watchWakeups(scout, closing.signal);

    expect(opened).toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(core.wakeStreams.opened).toEqual([]);
  });

  it('is refused while the server stops', async () => {
    core.wakeStreams.stop();

    const opened = await useCases.watchWakeups(scout, closing.signal);

    expect(opened).toMatchObject({ isOk: false, error: { kind: 'SERVER_STOPPING' } });
  });
});

describe('an open wake stream', () => {
  let stream: AsyncIterator<WakeStreamItem>;

  beforeEach(async () => {
    stream = await open();
    await nextOf(stream);
  });

  it('wakes once for each notice of a delivery made pending for its ship or its type', async () => {
    core.wakeStreams.wake('notice');
    core.wakeStreams.wake('notice');

    await expect(nextOf(stream)).resolves.toEqual({ kind: 'wake', reason: 'notice' });
    await expect(nextOf(stream)).resolves.toEqual({ kind: 'wake', reason: 'notice' });
  });

  it('wakes with reason reconnect when the listener listens again', async () => {
    core.wakeStreams.wake('reconnect');

    await expect(nextOf(stream)).resolves.toEqual({ kind: 'wake', reason: 'reconnect' });
  });

  it('sends a keep-alive once 25 s pass without a wake', async () => {
    const next = nextOf(stream);

    core.wakeStreams.passKeepAlive();

    await expect(next).resolves.toEqual({ kind: 'keepAlive' });
    expect(core.wakeStreams.waits).toEqual([KEEP_ALIVE_MS]);
  });

  it.each([
    ['wake', () => {
      core.wakeStreams.wake('notice');
    }],
    ['keep-alive', () => {
      core.wakeStreams.passKeepAlive();
    }],
  ])('ends with LEASE_ENDED at the next %s once the lease ended, and closes', async (_moment, next) => {
    unwrap(await registryUseCases(core).releaseShip(argo, { shipId: scoutId }));

    next();

    await expect(nextOf(stream)).resolves.toMatchObject({ kind: 'end', refusal: { kind: 'LEASE_ENDED' } });
    await expect(nextOf(stream)).resolves.toBe('closed');
    expect(core.wakeStreams.watching()).toBe(0);
  });

  it('closes when the server stops', async () => {
    core.wakeStreams.stop();

    await expect(nextOf(stream)).resolves.toBe('closed');
    expect(core.wakeStreams.watching()).toBe(0);
  });

  it('closes and stops watching when the crew closes it', async () => {
    const next = nextOf(stream);

    closing.abort();

    await expect(next).resolves.toBe('closed');
    expect(core.wakeStreams.watching()).toBe(0);
  });
});
