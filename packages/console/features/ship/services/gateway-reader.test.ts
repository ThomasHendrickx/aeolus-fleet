import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { gatewayReaderOf } from './gateway-reader';

const newId = createIdGenerator();
const GATEWAY = { shipId: newId('ship'), name: 'gateway' };
const ARGO_ID = newId('ship');

describe('the gateway mark on a ship page (decision 0068, B19, screen 4)', () => {
  it('given a sealed fleet and a ship the gateway crews, then the mark names the gateway as its crew', () => {
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'person', commissionedByShipId: ARGO_ID }, leaseBy: { kind: 'gateway' }, gateway: GATEWAY })).toEqual({ as: 'crew', gateway: GATEWAY });
  });

  it("given a sealed fleet and the gateway's proxy ship, then the mark says it is the gateway's proxy ship", () => {
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'app', commissionedByShipId: GATEWAY.shipId }, leaseBy: { kind: 'gateway' }, gateway: GATEWAY })).toEqual({ as: 'proxyShip', gateway: GATEWAY });
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'app', commissionedByShipId: GATEWAY.shipId }, leaseBy: null, gateway: GATEWAY })).toEqual({ as: 'proxyShip', gateway: GATEWAY });
  });

  it('given the gateway crews a ship and the console does not know its connection, then the mark names it by its name alone', () => {
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'person', commissionedByShipId: ARGO_ID }, leaseBy: { kind: 'gateway' }, gateway: undefined })).toEqual({ as: 'crew', gateway: { name: 'gateway' } });
  });

  it('given a ship crewed elsewhere, or an app ship another ship commissioned, then no mark', () => {
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'agent', commissionedByShipId: ARGO_ID }, leaseBy: { kind: 'pluginWatcher' }, gateway: GATEWAY })).toBeUndefined();
    expect(gatewayReaderOf({ isSealed: true, ship: { kind: 'app', commissionedByShipId: ARGO_ID }, leaseBy: { kind: 'adapter' }, gateway: GATEWAY })).toBeUndefined();
  });

  it('given a fleet without sealing, then no mark on any ship', () => {
    expect(gatewayReaderOf({ isSealed: false, ship: { kind: 'app', commissionedByShipId: GATEWAY.shipId }, leaseBy: { kind: 'gateway' }, gateway: GATEWAY })).toBeUndefined();
  });
});
