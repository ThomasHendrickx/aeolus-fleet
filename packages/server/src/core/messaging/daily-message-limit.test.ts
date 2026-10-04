import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  deliveryIdOf,
  deliveryInFlight,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  withInstallationSettings,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';

const MODEL = 'claude-opus-5-5';
const LIMIT_REACHED = {
  isOk: false,
  error: { kind: 'MESSAGE_LIMIT_REACHED', message: 'The fleet reached its limit of 3 messages today (UTC), so nothing was stored. Sending works again after 00:00 UTC.' },
};

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;
let messaging: ReturnType<typeof messagingUseCases>;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  messaging = messagingUseCases(core);
});

/** A send from the scout to argo, with a key of its own. */
function fromScout() {
  return messaging.sendMessage(scout, { selector: { kind: 'ship', name: 'argo' }, payload: 'Done', model: MODEL, idempotencyKey: newKey() });
}

/** A message stored in the fleet at the given time, as an earlier send would have left it. */
function storedAt(at: string): { deliveryId: DeliveryId } {
  const now = core.clock.now();
  core.clock.set(at);
  const stored = deliveryInFlight(core, { fleetId, shipId: scoutId, leaseId: scout.leaseId });
  core.clock.set(now);
  return stored;
}

describe("a fleet's daily message limit", () => {
  it('takes sends up to the limit, then refuses the next and stores nothing', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 3 });
    unwrap(await fromScout());
    unwrap(await fromScout());
    unwrap(await fromScout());
    const before = structuredClone(core.state);

    await expect(fromScout()).resolves.toEqual(LIMIT_REACHED);
    expect(core.state).toEqual(before);
  });

  it("counts every message stored today in UTC, argo's and pings included, and none from yesterday", async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 3 });
    storedAt('2026-10-03T23:59:59.999Z');
    storedAt('2026-10-04T00:00:00.000Z');
    unwrap(await messaging.sendMessage(argo, { selector: { kind: 'ship', shipId: scoutId }, payload: 'Review', idempotencyKey: newKey() }));
    unwrap(await messaging.pingShip(argo, { shipId: scoutId }));

    await expect(fromScout()).resolves.toEqual(LIMIT_REACHED);
  });

  it('takes sends again after 00:00 UTC', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 3 });
    storedAt('2026-10-04T01:00:00.000Z');
    storedAt('2026-10-04T02:00:00.000Z');
    storedAt('2026-10-04T03:00:00.000Z');
    core.clock.set('2026-10-05T00:00:00.000Z');

    await expect(fromScout()).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a reply, a ping and a resend at the limit too', async () => {
    const toArgo = unwrap(await fromScout());
    const { deliveryId } = storedAt('2026-10-04T11:00:00.000Z');
    for (const delivery of core.state.deliveries) {
      if (delivery.id === deliveryId) {
        delivery.state = 'undeliverable';
      }
    }
    const operator = await argoAboard(core);
    withInstallationSettings(core, { defaultDailyMessageLimit: 2 });

    await expect(messaging.replyToMessage(operator, { deliveryId: deliveryIdOf(core, toArgo.messageId), payload: 'Thanks', idempotencyKey: newKey() })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'MESSAGE_LIMIT_REACHED' },
    });
    await expect(messaging.pingShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: false, error: { kind: 'MESSAGE_LIMIT_REACHED' } });
    await expect(messaging.resendDelivery(argo, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'MESSAGE_LIMIT_REACHED' } });
  });

  it('still answers a send that comes again under its key with the message it stored, at the limit', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 1 });
    const send = { selector: { kind: 'ship' as const, name: 'argo' }, payload: 'Done', model: MODEL, idempotencyKey: 'once' };
    const first = unwrap(await messaging.sendMessage(scout, send));

    await expect(messaging.sendMessage(scout, send)).resolves.toEqual({ isOk: true, value: first });
  });

  it('follows a limit set for the fleet over the default, and no limit sets none', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 1 });
    core.state.fleetLimitSettings.push({ fleetId, ships: { kind: 'default' }, dailyMessages: { kind: 'fleet', limit: null } });

    unwrap(await fromScout());
    await expect(fromScout()).resolves.toMatchObject({ isOk: true });
  });
});
