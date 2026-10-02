import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from './caller.js';
import type { FleetNewsWatch } from './events.js';
import { createFollowFleet, type FollowFleet } from './follow-fleet.js';

let core: InMemoryCore;
let argo: Caller;
/** What the next wait does: by default the whole wait passes on the clock. */
let nextWait: (waitMs: number) => Promise<'woken' | 'timedOut'>;
const waits: number[] = [];
let followFleet: FollowFleet;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-02T19:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  waits.length = 0;
  nextWait = (waitMs) => {
    core.clock.advance(waitMs);
    return Promise.resolve('timedOut');
  };
  const watch: FleetNewsWatch = {
    next: (waitMs) => {
      waits.push(waitMs);
      return nextWait(waitMs);
    },
    stop: () => undefined,
  };
  followFleet = createFollowFleet({ feed: core.feed, clock: core.clock, wakeups: { watch: () => watch } });
});

async function commission(name: string): Promise<void> {
  unwrap(await registryUseCases(core).commissionShip(argo, { name, type: 'reviewer' }));
}

async function lastSeq(): Promise<number> {
  return core.feed.lastSeq(argo.fleetId);
}

describe('following the fleet', () => {
  it('answers no events and the current number to start from, without a position', async () => {
    await commission('scout');

    await expect(followFleet(argo, {})).resolves.toEqual({ isOk: true, value: { events: [], lastSeq: await lastSeq() } });
  });

  it('answers the events after the position, oldest first, and the number of the last one', async () => {
    const from = await lastSeq();
    await commission('scout');
    await commission('lookout');

    const { events, lastSeq: last } = unwrap(await followFleet(argo, { afterSeq: from }));

    expect(events.map((event) => event.type)).toEqual([
      'ShipCommissioned',
      'StartingPromptIssued',
      'ShipCommissioned',
      'StartingPromptIssued',
    ]);
    expect(events.map((event) => event.seq)).toEqual([from + 1, from + 2, from + 3, from + 4]);
    expect(last).toBe(from + 4);
  });

  it('answers at most max events, so the next call follows on from the last one', async () => {
    const from = await lastSeq();
    await commission('scout');
    await commission('lookout');

    const first = unwrap(await followFleet(argo, { afterSeq: from, max: 3 }));
    const rest = unwrap(await followFleet(argo, { afterSeq: first.lastSeq, max: 3 }));

    expect(first.events).toHaveLength(3);
    expect(rest.events.map((event) => event.seq)).toEqual([from + 4]);
  });

  it('answers no events and the same position when nothing came, without waiting', async () => {
    const from = await lastSeq();

    await expect(followFleet(argo, { afterSeq: from })).resolves.toEqual({ isOk: true, value: { events: [], lastSeq: from } });
    expect(waits).toEqual([]);
  });

  it('waits up to waitSeconds while nothing came, then answers none', async () => {
    const from = await lastSeq();

    await expect(followFleet(argo, { afterSeq: from, waitSeconds: 25 })).resolves.toEqual({
      isOk: true,
      value: { events: [], lastSeq: from },
    });
    expect(waits).toEqual([25_000]);
  });

  it('answers as soon as an event commits while it waits', async () => {
    const from = await lastSeq();
    nextWait = async () => {
      core.clock.advance(1_000);
      await commission('scout');
      return 'woken';
    };

    const { events } = unwrap(await followFleet(argo, { afterSeq: from, waitSeconds: 25 }));

    expect(events.map((event) => event.type)).toEqual(['ShipCommissioned', 'StartingPromptIssued']);
  });

  it.each([
    ['no event at most', { max: 0 }, 'INVALID_FOLLOW_MAX'],
    ['more than 100 at most', { max: 101 }, 'INVALID_FOLLOW_MAX'],
    ['a wait over 25 seconds', { waitSeconds: 26 }, 'INVALID_FOLLOW_WAIT'],
    ['a negative wait', { waitSeconds: -1 }, 'INVALID_FOLLOW_WAIT'],
  ])('refuses %s', async (_label, input, kind) => {
    await expect(followFleet(argo, { afterSeq: 0, ...input })).resolves.toMatchObject({ isOk: false, error: { kind } });
  });
});
