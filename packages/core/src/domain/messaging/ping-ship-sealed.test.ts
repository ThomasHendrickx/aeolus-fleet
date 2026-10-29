import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { PING_PAYLOAD } from './ping-ship.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  await sealFleet(core, fleetId);
});

describe('a ping in a sealed fleet (decision 0068, B17)', () => {
  it('stores the ping core writes sealed, and its ship receives the ping as sent', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));

    const [currentKey] = core.state.dataKeys;
    expect(core.state.messages.find((held) => held.id === messageId)?.payload).toMatchObject({ sealed: { dataKeyId: currentKey?.id }, plainBytes: 45 });
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));
    expect(deliveries.map(({ messageId: id, payload }) => ({ id, payload }))).toEqual([{ id: messageId, payload: PING_PAYLOAD }]);
  });
});
