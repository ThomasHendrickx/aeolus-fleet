import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShipCaller, Crew } from '../src/domain/shared/caller.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { newKey } from '../src/testing/keys.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// Who wakes a lease and the channel of a hand-over on a real Postgres
// (interop 5.1): stored with the lease and DeliveryHanded, read back on the
// ship's side of the way and the message's history.

let core: PostgresCore;
let argo: ShipCaller;
let crm: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'crm', type: 'crm', kind: 'app' }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'aeolus-gateway' }));
  crm = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await core.close();
});

describe('who wakes a lease and the channel of a hand-over on Postgres', () => {
  it('keeps the waker the first push receive stated, and the channel each hand-over named', async () => {
    const { messageId } = unwrap(
      await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: crm.shipId }, payload: '{"id":42}', contentType: 'application/json', idempotencyKey: newKey() }),
    );
    const [received] = unwrap(await core.useCases.pushReceiveDeliveries(crm, { waker: 'gateway' })).deliveries;
    if (!received) {
      throw new Error('The push receive took nothing');
    }
    unwrap(await core.useCases.pushReceiveDeliveries(crm, { waker: 'adapter' }));
    unwrap(await core.useCases.handOverDelivery(crm, { deliveryId: received.deliveryId, handOverNumber: 1, channel: 'tools/call' }));

    expect(unwrap(await core.useCases.readShipWay(argo, { shipId: crm.shipId })).lease?.by).toEqual({ kind: 'gateway' });
    const { delivery } = unwrap(await core.useCases.readMessage(argo, { messageId }));
    expect(delivery.history.find((step) => step.type === 'DeliveryHanded')).toMatchObject({ by: { kind: 'gateway' }, channel: 'tools/call' });
  });
});
