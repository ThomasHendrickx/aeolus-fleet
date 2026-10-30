import { describe, expect, it } from 'vitest';

import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { createReadReportTasks } from './read-report-tasks.js';

// Monitoring 4.2: opening a task is decided for this viewer, never from its ids.
describe('message task canOpen per viewer', () => {
  it('allows the viewer in read reach, refuses a viewer outside it and one without fleet:read', async () => {
    // Given one message whose parties only one of these viewers can read.
    const scene = await readReachScenario();
    await scene.readRulesApply();
    const messageId = await scene.send(scene.far, { kind: 'ship', shipId: scene.argo.shipId });
    const task = { kind: 'message', fleetId: scene.argo.fleetId, messageId, canOpen: true };
    const read = createReadReportTasks({ history: scene.core.history, readReach: async (caller) => caller.kind === 'operator' ? { kind: 'every' } : { kind: 'some', shipIds: new Set(), types: new Set() } });

    // When each viewer reads the same task.
    const allowed = await read(scene.argo, [task]);
    const outside = await read(scene.reader, [task]);
    const noScope = await read({ ...scene.argo, scopes: [] }, [task]);

    // Then only the authorized viewer gets a link, even if the reported task claims otherwise.
    expect(allowed[0]).toMatchObject({ canOpen: true });
    expect(outside[0]).toMatchObject({ canOpen: false });
    expect(noScope[0]).toMatchObject({ canOpen: false });
  });

  it('keeps a missing message and a message in another fleet as text', async () => {
    // Given references core accepts without looking up their existence.
    const scene = await readReachScenario();
    const read = createReadReportTasks({ history: scene.core.history, readReach: async () => ({ kind: 'every' }) });
    const tasks = [
      { kind: 'message', fleetId: scene.argo.fleetId, messageId: scene.core.ids('message') },
      { kind: 'message', fleetId: scene.core.ids('fleet'), messageId: scene.core.ids('message') },
    ];

    // When the viewer reads them.
    const result = await read(scene.argo, tasks);

    // Then neither reference offers a link.
    expect(result.map((task) => task?.canOpen)).toEqual([false, false]);
  });
});
