import type { DeliveryId, FleetId, MessageId } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import type { FleetDoor, ReceivedMessage } from '../../core/management/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import type { ManagementOutcome } from '../../core/squadron/handle-management-delivery.js';
import { watchManagementShips } from './management-watch.js';

const AT = new Date('2026-10-18T11:00:00.000Z');
const silentLog = Fastify({ logger: false }).log;

function aDelivery(number: number): ReceivedMessage {
  const id = String(number).padStart(4, '0');
  const deliveryId: DeliveryId = `dlv_01m3tbfspe96yf1rnr4ank${id}`;
  const messageId: MessageId = `msg_01m3tbfspe96yf1rnr4ank${id}`;
  return { deliveryId, messageId, senderShipId: SHIP_ID, senderName: 'tech-lead', contentType: 'application/vnd.aeolus.squadron.form+json', payload: '{}', inReplyTo: null };
}

/** A receive that waits until the watch stops, as a long poll with nothing to hand over. */
function waitingReceive(until?: { signal: AbortSignal }): Promise<Result<ReceivedMessage[], never>> {
  return new Promise((_resolve, reject) => {
    until?.signal.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });
}

async function connectedTo(fleets: FleetId[]) {
  const store = memoryManagementStore();
  for (const fleetId of fleets) {
    await store.save({ fleetId, shipId: SHIP_ID, name: 'squadrons', crewToken: `aeolus_ct_v1_${fleetId}`, crewedAt: AT });
  }
  return store;
}

describe("squadrons' own ship in every connected fleet (decision 0017)", () => {
  it("receives as each fleet's ship and hands each delivery to its rule with that fleet's crew", async () => {
    const store = await connectedTo([FLEET_ID, OTHER_FLEET_ID]);
    const handed: { fleetId: FleetId; deliveryId: DeliveryId }[] = [];
    const given = new Set<string>();
    const door: FleetDoor = {
      ...fakeManagementFleet().door,
      receive: (crewToken, until) => {
        if (given.has(crewToken)) {
          return waitingReceive(until);
        }
        given.add(crewToken);
        return Promise.resolve(ok([aDelivery(crewToken.endsWith(FLEET_ID) ? 1 : 2)]));
      },
    };
    const watch = watchManagementShips({
      door,
      management: store,
      handle: (crew, delivery): Promise<Result<ManagementOutcome, never>> => {
        handed.push({ fleetId: crew.fleetId, deliveryId: delivery.deliveryId });
        return Promise.resolve(ok('formed'));
      },
      isServed: () => Promise.resolve(true),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await expect.poll(() => handed.length).toBe(2);
    await watch.stop();

    expect(handed).toEqual(
      expect.arrayContaining([
        { fleetId: FLEET_ID, deliveryId: aDelivery(1).deliveryId },
        { fleetId: OTHER_FLEET_ID, deliveryId: aDelivery(2).deliveryId },
      ]),
    );
  });

  it('does not receive in a fleet squadrons does not serve', async () => {
    const store = await connectedTo([FLEET_ID, OTHER_FLEET_ID]);
    const receivedAs = new Set<string>();
    const watch = watchManagementShips({
      door: {
        ...fakeManagementFleet().door,
        receive: (crewToken, until) => {
          receivedAs.add(crewToken);
          return waitingReceive(until);
        },
      },
      management: store,
      handle: () => Promise.resolve(ok('formed')),
      isServed: (fleetId) => Promise.resolve(fleetId === FLEET_ID),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await expect.poll(() => receivedAs.size).toBe(1);
    await watch.rescan();
    await watch.stop();

    expect([...receivedAs]).toEqual([`aeolus_ct_v1_${FLEET_ID}`]);
  });

  it('stops receiving once its lease ended, and a rescan does not receive on the dropped crew token again', async () => {
    const store = await connectedTo([FLEET_ID]);
    let receives = 0;
    const watch = watchManagementShips({
      door: {
        ...fakeManagementFleet().door,
        receive: async () => {
          receives += 1;
          // As the lease-watching door does: LEASE_ENDED drops the fleet's crew token.
          await store.drop(FLEET_ID);
          return err({ code: 'LEASE_ENDED', message: 'released' });
        },
      },
      management: store,
      handle: () => Promise.resolve(ok('formed')),
      isServed: () => Promise.resolve(true),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await expect.poll(() => receives).toBe(1);
    await watch.rescan();
    await watch.stop();

    expect(receives).toBe(1);
  });

  it('waits on stop for a delivery being handled, so nothing touches the database once the app closes', async () => {
    const store = await connectedTo([FLEET_ID]);
    let isGiven = false;
    let finish: () => void = () => undefined;
    const handling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let isHandlingDone = false;
    let isHandlingStarted = false;
    const watch = watchManagementShips({
      door: {
        ...fakeManagementFleet().door,
        receive: (_crewToken, until) => {
          if (isGiven) {
            return waitingReceive(until);
          }
          isGiven = true;
          return Promise.resolve(ok([aDelivery(1)]));
        },
      },
      management: store,
      handle: async (): Promise<Result<ManagementOutcome, never>> => {
        isHandlingStarted = true;
        await handling;
        isHandlingDone = true;
        return ok('formed');
      },
      isServed: () => Promise.resolve(true),
      log: silentLog,
      rescanMs: 60_000,
    });
    await watch.rescan();
    await expect.poll(() => isHandlingStarted).toBe(true);

    const stopped = watch.stop();
    finish();
    await stopped;

    expect(isHandlingDone).toBe(true);
  });
});
