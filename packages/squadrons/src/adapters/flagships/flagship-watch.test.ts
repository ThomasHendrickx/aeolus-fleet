import type { DeliveryId, MessageId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import type { FleetDoor } from '../../core/management/ports.js';
import { ok, type Result } from '../../core/shared/result.js';
import type { FlagshipOutcome } from '../../core/squadron/handle-flagship-delivery.js';
import type { Squadron } from '../../core/squadron/squadron.js';
import { watchFlagships } from './flagship-watch.js';

const AT = new Date('2026-10-03T11:00:00.000Z');
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';

const forming: Squadron = {
  id: 'team-a1b2c3',
  fleetId: FLEET_ID,
  state: 'forming',
  blueprint: { repository: 'example.com/templates', name: 'team', version: 1, commit: 'b1', committedAt: AT, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
  templates: [],
  flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
  members: [],
  formedAt: AT,
  sailedAt: null,
};

const silentLog = { error: () => undefined, warn: () => undefined, info: () => undefined };

describe('stopping the flagship watch', () => {
  it('waits for a delivery being handled, so nothing touches the database once the app closes', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    let isReceived = false;
    const door: FleetDoor = {
      ...fakeManagementFleet().door,
      receive: (_crewToken, until) => {
        if (!isReceived) {
          isReceived = true;
          const deliveryId: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank0001';
          const messageId: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0001';
          return Promise.resolve(ok([{ deliveryId, messageId, senderShipId: SHIP_ID, senderName: 'a-member', contentType: 'text/plain', payload: 'hello', inReplyTo: null }]));
        }
        return new Promise((_resolve, reject) => {
          until?.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      },
    };
    let finishHandling: () => void = () => undefined;
    let isHandlingDone = false;
    const handling = new Promise<void>((resolve) => {
      finishHandling = resolve;
    });
    let isHandlingStarted = false;
    const watch = watchFlagships({
      door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([forming]), update: () => Promise.resolve() },
      handle: async (): Promise<Result<FlagshipOutcome, never>> => {
        isHandlingStarted = true;
        await handling;
        isHandlingDone = true;
        return ok('kept');
      },
      operator: { tell: () => Promise.resolve() },
      log: silentLog,
      rescanMs: 60_000,
    });
    await watch.rescan();
    await expect.poll(() => isHandlingStarted).toBe(true);

    const stopped = watch.stop();
    let isStopped = false;
    void stopped.then(() => {
      isStopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isStopped).toBe(false);

    finishHandling();
    await stopped;
    expect(isHandlingDone).toBe(true);
  });
});
