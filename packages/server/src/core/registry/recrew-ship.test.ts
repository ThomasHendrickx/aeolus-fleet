import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  FLEET_URL,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let firstSecret: string;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  const commissioned = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  firstSecret = secretIn(commissioned.prompt);
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  core.clock.advance(60_000);
});

describe('re-crewing a ship', () => {
  it('releases the crewed ship and hands out a new starting prompt and crew line, all at once', async () => {
    const { messageId } = unwrap(
      await messaging.sendMessage(argo, { selector: { kind: 'ship', shipId: scoutId }, payload: 'Review', idempotencyKey: 'k1' }),
    );
    unwrap(await messaging.receiveDeliveries(scout, {}));

    const issued = unwrap(await registry.recrewShip(argo, { shipId: scoutId }));

    expect(issued.shipId).toBe(scoutId);
    expect(issued.crewLine).toBe(`/aeolus:crew ${FLEET_URL} ${scoutId} ${secretIn(issued.prompt)}`);
    await expect(messaging.receiveDeliveries(scout, {})).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
    expect(core.state.deliveries.find((held) => held.id === deliveryIdOf(core, messageId))).toMatchObject({ state: 'pending' });
    expect(core.state.events.map((event) => event.type).slice(-4)).toEqual([
      'CredentialRevoked',
      'LeaseRevoked',
      'DeliveryReturned',
      'StartingPromptIssued',
    ]);
  });

  it('lets the new secret claim the ship, and never the old one', async () => {
    const issued = unwrap(await registry.recrewShip(argo, { shipId: scoutId }));

    await expect(registry.claimShip({ shipId: scoutId, secret: firstSecret, location: { kind: 'CLOUD' }, harness: 'claude-code' })).resolves.toMatchObject({
      isOk: false,
    });
    await expect(
      registry.claimShip({ shipId: scoutId, secret: secretIn(issued.prompt), location: { kind: 'CLOUD' }, harness: 'claude-code' }),
    ).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a ship awaiting crew: it gets a new starting prompt instead', async () => {
    unwrap(await registry.releaseShip(argo, { shipId: scoutId }));

    await expect(registry.recrewShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_CREWED' },
    });
  });

  it('refuses argo, which is permanent', async () => {
    await expect(registry.recrewShip(argo, { shipId: argo.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT' },
    });
  });
});
