import type { DeliveryId, MessageId, ShipId } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, fakeManagementFleet, memoryManagementStore } from '../../../test/support/management-fakes.js';
import type { FleetDoor } from '../../core/management/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import type { FlagshipOutcome } from '../../core/squadron/handle-flagship-delivery.js';
import type { Squadron } from '../../core/squadron/squadron.js';
import { watchFlagships } from './flagship-watch.js';
import { createFleetTurns } from './fleet-turns.js';

const AT = new Date('2026-10-03T11:00:00.000Z');
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';

const forming: Squadron = {
  id: 'team-a1b2c3',
  fleetId: FLEET_ID,
  state: 'forming',
  blueprint: { repository: 'example.com/templates', name: 'team', version: 1, file: 'squadrons/fixture.yaml', commit: 'b1', committedAt: AT, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
  templates: [],
  flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
  members: [],
  formedAt: AT,
  sailedAt: null,
};

/** No formation to recover: what most tests need. */
const noRecovery = () => Promise.resolve();

/** A fleet's reach left as it is: what most tests need. */
const untouchedReach = { keep: () => Promise.resolve(), withdraw: () => Promise.resolve() };

// A logger that writes nothing: the watch logs only what goes wrong.
const silentLog = Fastify({ logger: false }).log;

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
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
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

describe('the flagships of every connected fleet', () => {
  it("receive on each fleet's squadrons, two squadrons of one id in two fleets included, and advance each fleet's stand-downs", async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    await store.save({ fleetId: OTHER_FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_other', crewedAt: AT });
    const theirs: Squadron = { ...forming, fleetId: OTHER_FLEET_ID, flagship: { ...forming.flagship, crewToken: 'aeolus_ct_v1_their_flagship' } };
    const receivedAs = new Set<string>();
    const advanced: string[] = [];
    const watch = watchFlagships({
      door: {
        ...fakeManagementFleet().door,
        receive: (crewToken, until) => {
          receivedAs.add(crewToken);
          return new Promise((_resolve, reject) => {
            until?.signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        },
      },
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: (fleetId) => Promise.resolve(fleetId === FLEET_ID ? [forming] : [theirs]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: (fleetId) => {
        advanced.push(fleetId);
        return Promise.resolve();
      },
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await expect.poll(() => receivedAs.size).toBe(2);
    await watch.stop();

    expect([...receivedAs].sort()).toEqual(['aeolus_ct_v1_flagship', 'aeolus_ct_v1_their_flagship']);
    expect(advanced.sort()).toEqual([FLEET_ID, OTHER_FLEET_ID].sort());
  });
});

describe('the flagships of a fleet squadrons does not serve', () => {
  it('do not receive, and its stand-downs do not advance, while the fleet is off', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    let receives = 0;
    const advanced: string[] = [];
    const watch = watchFlagships({
      door: {
        ...fakeManagementFleet().door,
        receive: () => {
          receives += 1;
          return Promise.resolve(ok([]));
        },
      },
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([forming]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: (fleetId) => {
        advanced.push(fleetId);
        return Promise.resolve();
      },
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(false),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.stop();

    expect(receives).toBe(0);
    expect(advanced).toEqual([]);
  });
});

describe('a released flagship', () => {
  it('is told to argo once: later rescans neither receive on it again nor tell argo again', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    let receives = 0;
    const told: { headline: string; body: string; key: string }[] = [];
    const watch = watchFlagships({
      door: {
        ...fakeManagementFleet().door,
        receive: () => {
          receives += 1;
          return Promise.resolve(err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }));
        },
      },
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([forming]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: {
        tell: (notice) => {
          told.push(notice);
          return Promise.resolve();
        },
      },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await expect.poll(() => told).toHaveLength(1);
    await watch.rescan();
    await watch.rescan();
    await watch.stop();

    expect(receives).toBe(1);
    expect(told.map(({ headline, body }) => ({ headline, body }))).toEqual([
      { headline: "A squadron's flagship was released", body: '- Squadron: `team-a1b2c3`\n\nsquadrons no longer receives on it, so check-ins to it go unanswered.' },
    ]);
  });

  it('is told under a key of its squadron, so a restart of squadrons tells argo no second time', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const keys: string[] = [];
    for (let start = 0; start < 2; start += 1) {
      const watch = watchFlagships({
        door: { ...fakeManagementFleet().door, receive: () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'released' })) },
        management: store,
        squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([forming]), update: () => Promise.resolve() },
        handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
        advanceStandDowns: () => Promise.resolve(),
        recoverFormations: noRecovery,
        isServed: () => Promise.resolve(true),
        operator: {
          tell: (notice) => {
            keys.push(notice.key);
            return Promise.resolve();
          },
        },
        reach: untouchedReach,
        turns: createFleetTurns(),
        log: silentLog,
        rescanMs: 60_000,
      });
      await watch.rescan();
      await expect.poll(() => keys).toHaveLength(start + 1);
      await watch.stop();
    }

    expect(keys).toEqual(['released-team-a1b2c3', 'released-team-a1b2c3']);
  });
});

describe('the flagship of a squadron standing down', () => {
  const standingDown: Squadron = { ...forming, state: 'standing-down' };

  async function connectedStore() {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    return store;
  }

  it('keeps receiving, so no message to the squadron goes unseen while its members finish', async () => {
    let isReceived = false;
    const handled: string[] = [];
    const watch = watchFlagships({
      door: {
        ...fakeManagementFleet().door,
        receive: () => {
          if (isReceived) {
            return new Promise(() => undefined);
          }
          isReceived = true;
          const deliveryId: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank0001';
          const messageId: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0001';
          return Promise.resolve(ok([{ deliveryId, messageId, senderShipId: SHIP_ID, senderName: 'a-member', contentType: 'text/plain', payload: 'done', inReplyTo: null }]));
        },
      },
      management: await connectedStore(),
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([standingDown]), update: () => Promise.resolve() },
      handle: (_squadron, delivery): Promise<Result<FlagshipOutcome, never>> => {
        handled.push(delivery.payload);
        return Promise.resolve(ok('kept'));
      },
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();

    await expect.poll(() => handled).toEqual(['done']);
    void watch.stop();
  });

  it('tells argo nothing when its lease ends because the squadron disbanded: squadrons retired it', async () => {
    let lists = 0;
    const told: string[] = [];
    const watch = watchFlagships({
      door: { ...fakeManagementFleet().door, receive: () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'retired' })) },
      management: await connectedStore(),
      squadrons: {
        exists: () => Promise.resolve(true),
        create: () => Promise.resolve(),
        list: () => {
          lists += 1;
          return Promise.resolve([lists <= 2 ? standingDown : { ...standingDown, state: 'disbanded' }]);
        },
        update: () => Promise.resolve(),
      },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: {
        tell: (notice) => {
          told.push(notice.headline);
          return Promise.resolve();
        },
      },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.stop();

    expect(told).toEqual([]);
  });

  it('advances every stand-down at each rescan', async () => {
    let advances = 0;
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: await connectedStore(),
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => {
        advances += 1;
        return Promise.resolve();
      },
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.rescan();
    await watch.stop();

    expect(advances).toBe(2);
  });
});

describe("each fleet's squadron labels and declared rules (#573)", () => {
  it('are kept at every rescan of a fleet squadrons serves', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    await store.save({ fleetId: OTHER_FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_other', crewedAt: AT });
    const kept: string[] = [];
    const withdrawn: string[] = [];
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: (fleetId) => Promise.resolve(fleetId === FLEET_ID),
      operator: { tell: () => Promise.resolve() },
      reach: {
        keep: (fleetId) => {
          kept.push(fleetId);
          return Promise.resolve();
        },
        withdraw: (fleetId) => {
          withdrawn.push(fleetId);
          return Promise.resolve();
        },
      },
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.stop();

    expect(kept).toEqual([FLEET_ID]);
    expect(withdrawn).toEqual([OTHER_FLEET_ID]);
  });

  it('are withdrawn at every rescan of a fleet that is off, which switching off could not while the fleet did not answer', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const withdrawn: string[] = [];
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(false),
      operator: { tell: () => Promise.resolve() },
      reach: {
        keep: () => Promise.reject(new Error('not served')),
        withdraw: (fleetId) => {
          withdrawn.push(fleetId);
          return Promise.resolve();
        },
      },
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.rescan();
    await watch.stop();

    expect(withdrawn).toEqual([FLEET_ID, FLEET_ID]);
  });

  it("go on to the next fleet when one fleet's fail", async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    await store.save({ fleetId: OTHER_FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_other', crewedAt: AT });
    const kept: string[] = [];
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: {
        keep: (fleetId) => {
          if (fleetId === FLEET_ID) {
            return Promise.reject(new Error('the database is gone'));
          }
          kept.push(fleetId);
          return Promise.resolve();
        },
        withdraw: () => Promise.resolve(),
      },
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.stop();

    expect(kept).toEqual([OTHER_FLEET_ID]);
  });
});

/** A gate the test opens: a pass waiting on it stays in flight until then. */
function aGate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Lets every pass that could start start. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("each fleet's formations a forming gave up (#738)", () => {
  it('are recovered at every rescan of a fleet squadrons serves', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    await store.save({ fleetId: OTHER_FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_other', crewedAt: AT });
    const recovered: string[] = [];
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: (fleetId) => {
        recovered.push(fleetId);
        return Promise.resolve();
      },
      isServed: (fleetId) => Promise.resolve(fleetId === FLEET_ID),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    await watch.rescan();
    await watch.rescan();
    await watch.stop();

    expect(recovered).toEqual([FLEET_ID, FLEET_ID]);
  });
});

describe("a fleet's rescans (#626)", () => {
  it("never overlap: a rescan while one is advancing the fleet's stand-downs or keeping its reach waits for it", async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const gate = aGate();
    let inFlight = 0;
    let mostInFlight = 0;
    const pass = async (): Promise<void> => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await gate.opened;
      inFlight -= 1;
    };
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: pass,
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: { keep: pass, withdraw: () => Promise.resolve() },
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    const first = watch.rescan();
    const second = watch.rescan();
    await settle();
    gate.open();
    await Promise.all([first, second]);
    await watch.stop();

    expect(mostInFlight).toBe(1);
  });

  it('asked while one runs share one rescan after it, so none is lost and none piles up', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const gate = aGate();
    let advances = 0;
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: async () => {
        advances += 1;
        await gate.opened;
      },
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: untouchedReach,
      turns: createFleetTurns(),
      log: silentLog,
      rescanMs: 60_000,
    });

    const first = watch.rescan();
    await expect.poll(() => advances).toBe(1);
    const asked = [watch.rescan(), watch.rescan(), watch.rescan()];
    gate.open();
    await Promise.all([first, ...asked]);
    await watch.stop();

    expect(advances).toBe(2);
  });

  it('do not undo a switch-off: its withdrawal waits for the rescan keeping the fleet, so the rules it declares are withdrawn after', async () => {
    const store = memoryManagementStore();
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT });
    const gate = aGate();
    const turns = createFleetTurns();
    const done: string[] = [];
    let isKeeping = false;
    const watch = watchFlagships({
      door: fakeManagementFleet().door,
      management: store,
      squadrons: { exists: () => Promise.resolve(true), create: () => Promise.resolve(), list: () => Promise.resolve([]), update: () => Promise.resolve() },
      handle: (): Promise<Result<FlagshipOutcome, never>> => Promise.resolve(ok('kept')),
      advanceStandDowns: () => Promise.resolve(),
      recoverFormations: noRecovery,
      isServed: () => Promise.resolve(true),
      operator: { tell: () => Promise.resolve() },
      reach: {
        keep: async () => {
          isKeeping = true;
          await gate.opened;
          done.push('declared');
        },
        withdraw: () => Promise.resolve(),
      },
      turns,
      log: silentLog,
      rescanMs: 60_000,
    });

    const rescan = watch.rescan();
    await expect.poll(() => isKeeping).toBe(true);
    const switchedOff = turns.take(FLEET_ID, () => {
      done.push('withdrawn');
      return Promise.resolve();
    });
    await settle();
    gate.open();
    await Promise.all([rescan, switchedOff]);
    await watch.stop();

    expect(done).toEqual(['declared', 'withdrawn']);
  });
});
