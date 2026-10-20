import { describe, expect, it } from 'vitest';

import { aFleetAnswering } from '../../../test/support/fake-fleet.js';
import { createRestNetworkDoor } from './rest-network-door.js';

describe('the network door over REST within read reach (decision 0034)', () => {
  it('lists the labels of the ships it reads whole, leaving out those outside its read reach', async () => {
    const whole = {
      id: 'shp_01m3tbfspe96yf1rnr4ank9h2a',
      name: 'scout',
      type: 'reviewer',
      kind: 'agent',
      status: 'crewed',
      startingPrompt: null,
      location: null,
      lastSeenAt: null,
      ping: null,
      scopes: ['messages:send', 'messages:receive'],
      report: null,
      crewRequest: null,
      labels: [{ labelId: 'lbl_01m3tbfspe96yf1rnr4ank9h2c', key: 'team', valueId: 'lbv_01m3tbfspe96yf1rnr4ank9h2d', value: 'a' }],
      model: null,
      harness: null,
      awaitingCrewSince: null,
      retiredAt: null,
      ownerShipId: null,
    };
    const outside = { id: 'shp_01m3tbfspe96yf1rnr4ank9h2b', name: 'vault', type: 'keeper', status: 'crewed', isInReadReach: false };
    await aFleetAnswering([{ status: 200, body: [whole, outside] }], async (fleetUrl) => {
      const listed = await createRestNetworkDoor(fleetUrl).listLabelledShips('aeolus_ct_v1_x');

      expect(listed).toEqual({ isOk: true, value: [{ shipId: whole.id, labels: [{ labelId: 'lbl_01m3tbfspe96yf1rnr4ank9h2c', valueId: 'lbv_01m3tbfspe96yf1rnr4ank9h2d' }] }] });
    });
  });
});
