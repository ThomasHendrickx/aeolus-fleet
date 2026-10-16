import { describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import type { OutgoingMessage } from '../../core/management/ports.js';
import { ok } from '../../core/shared/result.js';
import { createOperatorNotices } from './operator-notices.js';

const AT = new Date('2026-10-16T11:00:00.000Z');

describe('telling argo', () => {
  it('sends argo the headline, a blank line and the body, in markdown, under the notice key (#849)', async () => {
    const management = memoryManagementStore();
    await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const sent: OutgoingMessage[] = [];
    const door = {
      ...fakeManagementFleet().door,
      send: (_crewToken: string, message: OutgoingMessage) => {
        sent.push(message);
        return Promise.resolve(ok({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9h1a' as const }));
      },
    };

    await createOperatorNotices({ door, management }).tell({ fleetId: FLEET_ID, headline: 'A squadron carries no squadron label', body: '- Squadron: `team-a1b2c3`', key: 'unlabelled-team-a1b2c3' });

    expect(sent).toEqual([
      {
        selector: { kind: 'ship', name: 'argo' },
        payload: 'A squadron carries no squadron label\n\n- Squadron: `team-a1b2c3`',
        contentType: 'text/markdown',
        idempotencyKey: 'notice-unlabelled-team-a1b2c3',
      },
    ]);
  });
});
