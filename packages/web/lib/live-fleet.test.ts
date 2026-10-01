import { describe, expect, it } from 'vitest';

import { isShipChange, liveStateOf } from './live-fleet';

describe('liveStateOf', () => {
  it.each([
    ['pending', 'live'],
    ['connecting', 'reconnecting'],
    ['idle', 'offline'],
    ['error', 'offline'],
  ] as const)('words a %s subscription as %s', (status, live) => {
    expect(liveStateOf(status)).toBe(live);
  });
});

describe('isShipChange', () => {
  it.each(['ShipCommissioned', 'ShipClaimed', 'LeaseRevoked', 'CredentialRevoked', 'StartingPromptIssued'] as const)(
    'reloads the snapshot for %s',
    (type) => {
      expect(isShipChange(type)).toBe(true);
    },
  );

  it.each(['MessageAccepted', 'DeliveryClaimed', 'DeliveryAcknowledged', 'DeliveryReturned'] as const)(
    'leaves the snapshot alone for %s',
    (type) => {
      expect(isShipChange(type)).toBe(false);
    },
  );
});
