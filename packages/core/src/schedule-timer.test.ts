import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startScheduleTimer, type ScheduleTimer } from './schedule-timer.js';

// A server's schedule timer (decision 0062, S14): it sends when the earliest
// next attempt it knows of is due, told of new and advanced schedules, and
// arms itself again for what the send answers is next. Fake timers move the
// clock.

const START = new Date('2026-10-25T09:00:00.000Z');

let sends: Date[];
let nextAttempts: (Date | undefined)[];
let errors: unknown[];
let failing: boolean;
let timer: ScheduleTimer;

function inMs(ms: number): Date {
  return new Date(START.getTime() + ms);
}

function start(): ScheduleTimer {
  timer = startScheduleTimer({
    send: () => {
      sends.push(new Date());
      if (failing) {
        return Promise.reject(new Error('the database is gone'));
      }
      return Promise.resolve({ nextAttemptAt: nextAttempts.shift() });
    },
    now: () => Date.now(),
    onError: (error) => {
      errors.push(error);
    },
  });
  return timer;
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  sends = [];
  nextAttempts = [];
  errors = [];
  failing = false;
});

afterEach(async () => {
  await timer.stop();
  vi.useRealTimers();
});

describe('a schedule timer', () => {
  it('sends once at start, for what came due while no server ran, and arms for the next attempt it answers', async () => {
    nextAttempts.push(inMs(5_000));
    start();

    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toEqual([START]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sends).toEqual([START, inMs(5_000)]);
  });

  it('sends when a schedule it is told of is due, not before', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);

    timer.told(inMs(3_000));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(sends).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(sends).toEqual([START, inMs(3_000)]);
  });

  it('arms earlier for an earlier schedule, and keeps the earlier one for a later', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);

    timer.told(inMs(10_000));
    timer.told(inMs(4_000));
    timer.told(inMs(8_000));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sends).toEqual([START, inMs(4_000)]);
  });

  it('waits at least a second between two sends, so a clock ahead of the database never spins it', async () => {
    nextAttempts.push(START, START);
    start();

    await vi.advanceTimersByTimeAsync(999);
    expect(sends).toEqual([START]);

    await vi.advanceTimersByTimeAsync(1);
    expect(sends).toEqual([START, inMs(1_000)]);
  });

  it('tells a failed send to onError and goes on with the next schedule it is told of', async () => {
    failing = true;
    start();
    await vi.advanceTimersByTimeAsync(0);
    failing = false;

    timer.told(inMs(2_000));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(errors).toHaveLength(1);
    expect(sends).toEqual([START, inMs(2_000)]);
  });

  it('sends nothing once stopped', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    timer.told(inMs(2_000));

    await timer.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(sends).toEqual([START]);
  });
});
