import { describe, expect, it } from 'vitest';

import { initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { createListFleets } from './list-fleets.js';

describe('list fleets', () => {
  it('lists the fleets this installation hosts', async () => {
    const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
    const { fleetId } = await initialiseFleet(core, 'home fleet');
    const listFleets = createListFleets({ fleets: { list: () => Promise.resolve(core.state.fleets) } });

    await expect(listFleets()).resolves.toEqual([
      { id: fleetId, name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') },
    ]);
  });

  it('lists none before the first fleet exists', async () => {
    const listFleets = createListFleets({ fleets: { list: () => Promise.resolve([]) } });

    await expect(listFleets()).resolves.toEqual([]);
  });
});
