import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { windowChartsOf, windowNameOf } from './subscription-windows';
import { usageWindowOf } from './usage-window';

const RANGE = usageWindowOf('24h', new Date('2026-10-28T09:41:12Z'));
const MAC = idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7ma01');
const reading = (readAt: string, usedPercent: number) => ({ readAt, usedPercent, resetsAt: '2026-10-28T12:00:00.000Z' });
const chart = (harness: string, windows: { windowMinutes: number; readings: ReturnType<typeof reading>[] }[]) => ({ machineShipId: MAC, machineName: 'trierarch-mac', harness, windows });

describe('the subscription windows card', () => {
  it.each([
    { minutes: 300, name: '5 hours' },
    { minutes: 10_080, name: '7 days' },
    { minutes: 1_440, name: '1 day' },
    { minutes: 90, name: '90 minutes' },
  ])('names a window of $minutes minutes $name', ({ minutes, name }) => {
    expect(windowNameOf(minutes)).toBe(name);
  });

  it('places each reading by its time in the range and its percent used, oldest first', () => {
    const [drawn] = windowChartsOf({ charts: [chart('claude-code', [{ windowMinutes: 300, readings: [reading('2026-10-27T09:00:00.000Z', 0), reading('2026-10-27T21:00:00.000Z', 40), reading('2026-10-28T09:00:00.000Z', 100)] }])], window: RANGE });

    expect(drawn?.lines[0]?.points).toEqual([{ at: 0, percent: 0 }, { at: 0.5, percent: 40 }, { at: 1, percent: 100 }]);
    expect(drawn?.lines[0]).toMatchObject({ name: '5 hours', latestPercent: 100 });
  });

  it('gives each window its own colour, the same window the same colour on every chart', () => {
    const windows = [
      { windowMinutes: 300, readings: [reading('2026-10-28T08:00:00.000Z', 10)] },
      { windowMinutes: 10_080, readings: [reading('2026-10-28T08:00:00.000Z', 20)] },
    ];
    const [first, second] = windowChartsOf({ charts: [chart('claude-code', windows), chart('codex', windows.slice(1))], window: RANGE });

    expect(first?.lines.map((line) => line.colour)).toEqual(['s1', 's2']);
    expect(second?.lines[0]?.colour).toBe('s2');
  });

  it('leaves out a harness that has no reading in the range', () => {
    const drawn = windowChartsOf({ charts: [chart('claude-code', [{ windowMinutes: 300, readings: [] }]), chart('codex', [{ windowMinutes: 300, readings: [reading('2026-10-28T08:00:00.000Z', 5)] }])], window: RANGE });

    expect(drawn.map((one) => one.harness)).toEqual(['codex']);
  });

  it('names the machine, and shows its id for one the fleet does not know', () => {
    const unknown = { ...chart('codex', [{ windowMinutes: 300, readings: [reading('2026-10-28T08:00:00.000Z', 5)] }]), machineName: null };

    expect(windowChartsOf({ charts: [unknown], window: RANGE })[0]?.machineName).toBe(MAC);
  });
});
