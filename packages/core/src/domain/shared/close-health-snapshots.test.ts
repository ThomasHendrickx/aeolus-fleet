import { beforeEach, describe, expect, it } from 'vitest';

import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { createCloseHealthSnapshots, type CloseHealthSnapshots } from './close-health-snapshots.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let scene: HistoryScenario;
let close: CloseHealthSnapshots;

beforeEach(async () => {
  scene = await historyScenario();
  close = createCloseHealthSnapshots({ fleets: scene.core.fleets, uow: scene.core.uow, clock: scene.core.clock });
});

function rows() {
  return scene.core.state.healthSnapshots.filter((row) => row.fleetId === scene.fleetId).toSorted((first, second) => first.hour.getTime() - second.hour.getTime());
}

function stuckAt(iso: string): number | undefined {
  return rows()
    .find((row) => row.hour.toISOString() === iso)
    ?.stuck.reduce((sum, counted) => sum + counted.count, 0);
}

/** A message to a type no ship has: stuck at the type from its send. */
async function sendToNoShip(): Promise<void> {
  await scene.send(scene.scout, { to: { kind: 'type', type: 'mapper' } });
}

describe('closing the stuck snapshot in the pass', () => {
  it("writes a fleet's first snapshot: the 168 hours up to the last hour mark", async () => {
    await close();

    expect(rows()).toHaveLength(168);
    expect(rows().at(-1)?.hour.toISOString()).toBe('2026-10-01T09:00:00.000Z');
    expect(rows().at(0)?.hour.toISOString()).toBe('2026-09-24T10:00:00.000Z');
  });

  it('closes the next hour from the latest, counting what was stuck at its mark', async () => {
    await close();
    await sendToNoShip();
    scene.core.clock.set('2026-10-01T10:30:00.000Z');

    await close();

    expect(rows().at(-1)?.hour.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(stuckAt('2026-10-01T09:00:00.000Z')).toBe(0);
    expect(stuckAt('2026-10-01T10:00:00.000Z')).toBe(1);
  });

  it('closes every hour it missed, oldest first', async () => {
    await close();
    await sendToNoShip();
    scene.core.clock.set('2026-10-01T12:10:00.000Z');

    await close();

    expect(rows().slice(-3).map((row) => [row.hour.toISOString(), stuckAt(row.hour.toISOString())])).toEqual([
      ['2026-10-01T10:00:00.000Z', 1],
      ['2026-10-01T11:00:00.000Z', 1],
      ['2026-10-01T12:00:00.000Z', 1],
    ]);
  });

  it('closes nothing while the latest hour is the last hour mark', async () => {
    await close();
    const before = structuredClone(rows());
    await sendToNoShip();

    await close();

    expect(rows()).toEqual(before);
  });

  it('keeps 168 hours: the oldest goes as a new one is closed', async () => {
    await close();
    scene.core.clock.advance(HOUR_MS);

    await close();

    expect(rows()).toHaveLength(168);
    expect(rows().at(0)?.hour.toISOString()).toBe('2026-09-24T11:00:00.000Z');
  });

  it('skips a fleet whose snapshot another instance is closing', async () => {
    scene.core.state.healthSnapshotLocks.push(scene.fleetId);

    await close();

    expect(rows()).toEqual([]);
  });

  it('writes the first snapshot again when the latest hour is over 168 hours old', async () => {
    await close();
    await sendToNoShip();
    scene.core.clock.advance(170 * HOUR_MS);

    await close();

    expect(rows()).toHaveLength(168);
    expect(rows().at(-1)?.hour.toISOString()).toBe('2026-10-08T11:00:00.000Z');
    expect(stuckAt('2026-10-08T11:00:00.000Z')).toBe(1);
  });
});
