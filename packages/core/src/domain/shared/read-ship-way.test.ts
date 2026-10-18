import { beforeEach, describe, expect, it } from 'vitest';

import type { MessageId, ShipId } from '@aeolus-fleet/common';

import { crewOfToken, deliveryIdOf } from '../../../test/support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { historyScenario, type HistoryScenario } from '../../../test/support/history-scenario.js';
import { newKey } from '../../../test/support/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Crew } from './caller.js';

let scene: HistoryScenario;

beforeEach(async () => {
  scene = await historyScenario();
});

const TEN_MINUTES = 10 * 60_000;

const read = async (shipId: ShipId = scene.scout.shipId) => unwrap(await scene.history.readShipWay(scene.argo, { shipId }));
const pushReceive = async (crew: Crew) => {
  scene.core.clock.advance(1_000);
  unwrap(await scene.messaging.pushReceiveDeliveries(crew, {}));
};
const handOver = async (crew: Crew, messageId: MessageId) => {
  scene.core.clock.advance(1_000);
  unwrap(await scene.messaging.handOverDelivery(crew, { deliveryId: deliveryIdOf(scene.core, messageId), handOverNumber: 1, isOnceMore: false }));
};
const toScout = () => scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.scout.shipId } });

describe("reading a ship's side of the way", () => {
  it('gives no side and nothing waiting while no session crews the ship', async () => {
    await toScout();
    unwrap(await scene.registry.releaseShip(scene.argo, { shipId: scene.scout.shipId }));

    await expect(read()).resolves.toEqual({ lease: null, waiting: 0, oldest: null });
  });

  it('gives a pull lease no computer side and no turn', async () => {
    expect((await read()).lease).toEqual({ by: null, turn: null });
  });

  it('names the plugin watcher of a session crewed by hand once its lease is pushed, with the turn its hooks reported', async () => {
    await pushReceive(scene.scout);
    const busyAt = scene.core.clock.now();
    unwrap(await scene.registry.reportTurn(scene.scout, { turn: 'busy', at: busyAt }));

    expect((await read()).lease).toEqual({ by: { kind: 'pluginWatcher' }, turn: { state: 'busy', at: busyAt } });
  });

  it('names the trierarch on its computer that crewed the session', async () => {
    const { registry, argo, core } = scene;
    const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
    const trierarch = await shipWithScopes({ registry, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'builder' }));
    unwrap(await registry.requestCrew(argo, { shipId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    unwrap(await registry.assignCrew(plugin, { shipId, trierarchShipId: trierarch.shipId }));
    const { secret } = unwrap(await registry.getStartingPrompt(trierarch, { shipId }));
    const { crewToken } = unwrap(await registry.claimShip({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    await pushReceive(await crewOfToken(core, crewToken));

    expect((await read(shipId)).lease?.by).toEqual({ kind: 'trierarch', trierarch: { id: trierarch.shipId, name: 'mac-mini' } });
  });

  it('gives the oldest delivery waiting for the ship, oldest sent first, and how many wait', async () => {
    const first = await toScout();
    await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await toScout();

    const way = await read();

    expect(way.waiting).toBe(3);
    expect(way.oldest).toMatchObject({ messageId: first, delivery: { state: 'pending', way: { holder: { kind: 'fleet' } } } });
  });

  it('counts what its crew holds received or handed, and leaves out what it acknowledged and what waits for other ships', async () => {
    const acknowledged = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, acknowledged);
    await scene.ack(scene.scout, acknowledged);
    await scene.send(scene.planner, { to: { kind: 'ship', shipId: scene.lookout.shipId } });
    const received = await toScout();
    await pushReceive(scene.scout);

    const way = await read();

    expect(way.waiting).toBe(1);
    expect(way.oldest).toMatchObject({ messageId: received, delivery: { state: 'received', way: { holder: { kind: 'pluginWatcher' } } } });
  });

  it('leaves out a delivery to its type that another ship of the type holds', async () => {
    await scene.send(scene.planner, { to: { kind: 'type', type: 'reviewer' } });
    await scene.receive(scene.lookout);
    const direct = await toScout();

    const way = await read();

    expect(way.waiting).toBe(1);
    expect(way.oldest?.messageId).toBe(direct);
  });

  it('gives the overdue clock argo was told of for the oldest one', async () => {
    const messageId = await toScout();
    await pushReceive(scene.scout);
    await handOver(scene.scout, messageId);
    scene.core.clock.advance(TEN_MINUTES);
    await scene.messaging.tellOverdueDeliveries();

    const { oldest } = await read();

    expect(oldest?.delivery).toMatchObject({ state: 'handed', attempts: 1, way: { isPulled: false, overdue: { clock: 'notConfirmed', minutes: 10 } } });
  });

  it('tells a delivery a plain receive handed, pulled', async () => {
    await toScout();
    await scene.receive(scene.scout);

    expect((await read()).oldest?.delivery).toMatchObject({ state: 'handed', way: { holder: { kind: 'agent' }, isPulled: true } });
  });

  it('knows no ship of another fleet', async () => {
    const elsewhere = { ...scene.argo, fleetId: scene.core.ids('fleet') };

    await expect(scene.history.readShipWay(elsewhere, { shipId: scene.scout.shipId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});

describe("reading the way of a ship outside read reach (decision 0034)", () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('refuses it as not reachable, one fixed message, no reasons', async () => {
    expect(refusalOf(await fleet.history.readShipWay(fleet.reader, { shipId: fleet.far.shipId }))).toEqual({
      kind: 'NOT_REACHABLE',
      message: 'The network rules do not allow this read',
    });
  });

  it('records the refusal for argo: reader and ship with their labels and owners then, the verb read, the settings version and when', async () => {
    await fleet.history.readShipWay(fleet.reader, { shipId: fleet.far.shipId });

    expect(fleet.core.state.reachRefusals).toEqual([
      expect.objectContaining({
        at: fleet.core.clock.now(),
        sender: expect.objectContaining({ id: fleet.reader.shipId, name: 'reader', labels: [expect.objectContaining({ key: 'team', value: 'a' })], owner: expect.objectContaining({ name: 'argo' }) }),
        recipient: { kind: 'ship', ship: expect.objectContaining({ id: fleet.far.shipId, labels: [expect.objectContaining({ key: 'team', value: 'b' })] }) },
        verb: 'read',
        settingsVersion: 4,
        whilePluginUnavailable: null,
      }),
    ]);
  });

  it('reads the way of a ship within read reach, and of itself, recording nothing', async () => {
    unwrap(await fleet.history.readShipWay(fleet.reader, { shipId: fleet.near.shipId }));
    unwrap(await fleet.history.readShipWay(fleet.far, { shipId: fleet.far.shipId }));

    expect(fleet.core.state.reachRefusals).toEqual([]);
  });
});
