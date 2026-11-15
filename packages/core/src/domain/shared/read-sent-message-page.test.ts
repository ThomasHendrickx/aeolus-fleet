import { beforeEach, describe, expect, it } from 'vitest';

import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { unwrap } from '../../testing/result.js';
import { createReadSentMessage, type ReadSentMessage } from './read-sent-message.js';

let scene: HistoryScenario;
let sentMessage: ReadSentMessage;

beforeEach(async () => {
  scene = await historyScenario();
  sentMessage = createReadSentMessage({ history: scene.core.history });
});

describe('a sender paging a label message', () => {
  it('reads the next deliveries by cursor without repeating them', async () => {
    unwrap(await scene.registry.defineLabel(scene.argo, { key: 'team', values: ['a'] }));
    const valueId = valueIdOf(scene.core, { key: 'team', value: 'a' });
    for (const crew of [scene.scout, scene.lookout, scene.planner]) {
      unwrap(await scene.registry.assignLabel(scene.argo, { shipId: crew.shipId, valueId }));
    }
    const messageId = await scene.send(scene.argo, { to: { kind: 'label', valueIds: [valueId] } });

    const first = unwrap(await sentMessage(scene.argo, { messageId, limit: 2 }));
    const second = unwrap(await sentMessage(scene.argo, { messageId, limit: 2, cursor: first.nextCursor ?? undefined }));

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]?.id);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
  });
});
