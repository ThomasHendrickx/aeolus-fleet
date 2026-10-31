import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  agentCaller,
  crewShip,
  deliveryIdOf,
  identityUseCases,
  initialiseFleet,
  messagingUseCases,
  OPERATOR,
  operatorCaller,
  registryUseCases,
  secretOf,
} from '../../../test/support/core-fixtures.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { wholeShips } from '../../../test/support/ships.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';

const commissionedAt = new Date('2026-09-29T12:00:00.000Z');

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: ShipCaller;
let scoutId: ShipId;
let scoutSecret: string;

beforeEach(async () => {
  core = createInMemoryCore(commissionedAt.toISOString());
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  const commissioned = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretOf(commissioned.secret);
  core.clock.advance(60_000);
});

async function listedScout(input?: Parameters<typeof useCases.listFleet>[1]) {
  return wholeShips((await useCases.listFleet(argo, input)).ships).find((ship) => ship.id === scoutId);
}

/** The scout as a listing that asks for retired ships shows it. */
async function listedRetiredScout() {
  return listedScout({ status: ['retired'] });
}

function scout() {
  return core.state.ships.find((ship) => ship.id === scoutId);
}

describe('when a crewed ship was last seen', () => {
  it('is null while no session crews it', async () => {
    await expect(listedScout()).resolves.toMatchObject({ lastSeenAt: null });
  });

  it('is when its session claimed it, until it calls again', async () => {
    const claimedAt = core.clock.now();
    unwrap(await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));

    await expect(listedScout()).resolves.toMatchObject({ lastSeenAt: claimedAt });
  });

  it('is its last call', async () => {
    const crewToken = crewShip(core, { fleetId, shipId: scoutId });
    core.clock.advance(30_000);
    await identityUseCases(core).authenticate.byCrewToken(crewToken);

    await expect(listedScout()).resolves.toMatchObject({ lastSeenAt: core.clock.now() });
  });
});

describe('since when a ship awaits crew', () => {
  it('is its commission while no session has crewed it yet', async () => {
    await expect(listedScout()).resolves.toMatchObject({ awaitingCrewSince: commissionedAt });
  });

  it('is null while a session crews it', async () => {
    crewShip(core, { fleetId, shipId: scoutId });

    await expect(listedScout()).resolves.toMatchObject({ awaitingCrewSince: null });
  });

  it('is when the operator released it', async () => {
    crewShip(core, { fleetId, shipId: scoutId });
    core.clock.advance(60_000);
    const releasedAt = core.clock.now();

    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    await expect(listedScout()).resolves.toMatchObject({ awaitingCrewSince: releasedAt });
  });

  it('is null once the ship is retired', async () => {
    unwrap(await useCases.retireShip(argo, { shipId: scoutId }));

    await expect(listedRetiredScout()).resolves.toMatchObject({ awaitingCrewSince: null });
  });
});

describe('when a ship was retired', () => {
  it('is null while the ship is active', async () => {
    await expect(listedScout()).resolves.toMatchObject({ retiredAt: null });
  });

  it('is when the operator retired it', async () => {
    const retiredAt = core.clock.now();

    unwrap(await useCases.retireShip(argo, { shipId: scoutId }));

    await expect(listedRetiredScout()).resolves.toMatchObject({ status: 'retired', retiredAt });
  });
});

describe("a ship's owner", () => {
  it('is the ship that owns it: argo, for a ship argo commissioned (decision 0045)', async () => {
    await expect(listedScout()).resolves.toMatchObject({ ownerShipId: argoId });
  });

  it('is none for argo', async () => {
    const listed = wholeShips((await useCases.listFleet(argo)).ships).find((ship) => ship.id === argoId);

    expect(listed).toMatchObject({ ownerShipId: null });
  });
});

describe('the model and harness a ship shows', () => {
  async function sendAs(shipId: ShipId, model: string): Promise<string> {
    const { messageId } = unwrap(
      await messagingUseCases(core).sendMessage(agentCaller({ fleetId, shipId }), {
        selector: { kind: 'ship', name: 'argo' },
        payload: 'Done with PR 48',
        model,
        idempotencyKey: newKey(),
      }),
    );
    return messageId;
  }

  it('shows the harness of the session crewing it, read with its location; none while no session crews it', async () => {
    await expect(listedScout()).resolves.toMatchObject({ harness: null });

    unwrap(await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'CLOUD' }, harness: 'codex' }));

    await expect(listedScout()).resolves.toMatchObject({ location: { kind: 'CLOUD', description: null }, harness: 'codex' });
  });

  it('shows the last model its sessions stated on a send, and when', async () => {
    await sendAs(scoutId, 'claude-sonnet-5-5');
    core.clock.advance(60_000);
    await sendAs(scoutId, 'claude-opus-5-5');

    await expect(listedScout()).resolves.toMatchObject({ model: { id: 'claude-opus-5-5', statedAt: core.clock.now() } });
  });

  it("keeps the last model its sessions stated when the operator resends an older message of the ship's", async () => {
    const older = await sendAs(scoutId, 'claude-sonnet-5-5');
    const deliveryId = deliveryIdOf(core, idSchema('message').parse(older));
    const delivery = core.state.deliveries.find((stored) => stored.id === deliveryId);
    if (delivery) {
      delivery.state = 'undeliverable';
    }
    core.clock.advance(60_000);
    await sendAs(scoutId, 'claude-opus-5-5');
    const statedAt = core.clock.now();
    core.clock.advance(60_000);

    unwrap(await messagingUseCases(core).resendDelivery(argo, { deliveryId }));

    await expect(listedScout()).resolves.toMatchObject({ model: { id: 'claude-opus-5-5', statedAt } });
  });

  it('shows no model before a send, and none for argo', async () => {
    const [listedArgo] = wholeShips((await useCases.listFleet(argo)).ships);

    expect(listedArgo?.model).toBeNull();
    await expect(listedScout()).resolves.toMatchObject({ model: null });
  });
});

describe('listing the fleet', () => {
  it('lists every ship in the order commissioned, argo first and without a prompt, with name, type, kind, status, prompt state and no location while awaiting crew', async () => {
    await expect(useCases.listFleet(argo).then((page) => page.ships)).resolves.toEqual([
      {
        id: argoId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        status: 'crewed',
        startingPrompt: null,
        location: null,
        lastSeenAt: null,
        ping: null,
        scopes: ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'scopes:define', 'meetings:open', 'fleet:keys', 'fleet:alert'],
        report: null,
        activity: null,
        openAlertCount: 0,
        crewRequest: null,
        labels: [],
        harness: null,
        model: null,
        awaitingCrewSince: null,
        retiredAt: null,
        ownerShipId: null,
      },
      {
        id: scoutId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        status: 'awaitingCrew',
        startingPrompt: { issuedAt: commissionedAt, isClaimed: false },
        location: null,
        lastSeenAt: null,
        ping: null,
        scopes: ['messages:send', 'messages:receive'],
        report: null,
        activity: null,
        openAlertCount: 0,
        crewRequest: null,
        labels: [],
        harness: null,
        model: null,
        awaitingCrewSince: commissionedAt,
        retiredAt: null,
        ownerShipId: argoId,
      },
    ]);
  });

  it('shows argo crewed from the device the operator signed in on', async () => {
    unwrap(await identityUseCases(core).signIn({ ...OPERATOR, device: 'Mac · Chrome' }));

    const [listedArgo] = wholeShips((await useCases.listFleet(argo)).ships);

    expect(listedArgo).toMatchObject({ status: 'crewed', location: { kind: 'OTHER', description: 'Mac · Chrome' } });
  });

  it('shows when the newest prompt was issued, unclaimed, after a new one replaced the first', async () => {
    unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    await expect(listedScout()).resolves.toMatchObject({
      startingPrompt: { issuedAt: core.clock.now(), isClaimed: false },
    });
  });

  it('shows a claimed ship crewed where its session runs, and its prompt claimed', async () => {
    unwrap(
      await useCases.claimShip({
        shipId: scoutId,
        secret: scoutSecret,
        location: { kind: 'OTHER', description: 'a ci runner' }, harness: 'claude-code',
      }),
    );

    await expect(listedScout()).resolves.toMatchObject({
      status: 'crewed',
      startingPrompt: { isClaimed: true },
      location: { kind: 'OTHER', description: 'a ci runner' },
    });
  });

  it('shows no prompt when the ship holds no valid secret', async () => {
    for (const credential of core.state.credentials.filter((held) => held.shipId === scoutId)) {
      credential.invalidatedAt = core.clock.now();
    }

    await expect(listedScout()).resolves.toMatchObject({ startingPrompt: null });
  });

  it('shows a ship crewed while a session holds its lease', async () => {
    crewShip(core, { fleetId, shipId: scoutId });

    await expect(listedScout()).resolves.toMatchObject({ status: 'crewed', location: { kind: 'DEVICE', description: null } });
  });

  it('shows a retired ship as retired', async () => {
    const retired = scout();
    if (retired) {
      retired.retiredAt = core.clock.now();
    }

    await expect(listedRetiredScout()).resolves.toMatchObject({ status: 'retired' });
  });

  it('answers the active ships only while the status filter asks for no retired ship', async () => {
    unwrap(await useCases.retireShip(argo, { shipId: scoutId }));

    await expect(useCases.listFleet(argo).then((page) => page.ships.map((ship) => ship.id))).resolves.toEqual([argoId]);
  });

  it('answers the retired ships too when the status filter asks for them beside the active ones', async () => {
    unwrap(await useCases.retireShip(argo, { shipId: scoutId }));

    await expect(useCases.listFleet(argo, { status: ['crewed', 'retired'] }).then((page) => page.ships.map((ship) => ship.id))).resolves.toEqual([argoId, scoutId]);
  });

  it("lists only the caller's fleet", async () => {
    const elsewhere = { ...argo, fleetId: core.ids('fleet') };

    await expect(useCases.listFleet(elsewhere).then((page) => page.ships)).resolves.toEqual([]);
  });

  it('never carries a secret or its hash', async () => {
    const listed = JSON.stringify((await useCases.listFleet(argo)).ships);

    expect(listed).not.toContain(scoutSecret);
    expect(listed).not.toContain(core.hasher.hash(scoutSecret));
  });
});

describe("a ship's last ping", () => {
  async function crewedScout() {
    const { crewToken } = unwrap(
      await useCases.claimShip({ shipId: scoutId, secret: scoutSecret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    );
    return unwrap(await identityUseCases(core).authenticate.byCrewToken(crewToken));
  }

  it('is null before argo ever pinged the ship', async () => {
    await crewedScout();

    await expect(listedScout()).resolves.toMatchObject({ ping: null });
  });

  it('waits for an answer, from when it was sent, while pending', async () => {
    await crewedScout();
    const sentAt = core.clock.now();
    unwrap(await messagingUseCases(core).pingShip(argo, { shipId: scoutId }));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'waiting', sentAt, answeredAt: null } });
  });

  it('still waits once the session received it, until it answers', async () => {
    const scoutCrew = await crewedScout();
    unwrap(await messagingUseCases(core).pingShip(argo, { shipId: scoutId }));
    unwrap(await messagingUseCases(core).receiveDeliveries(scoutCrew, {}));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'waiting' } });
  });

  it('still waits once a push receive holds it, until it answers', async () => {
    const scoutCrew = await crewedScout();
    unwrap(await messagingUseCases(core).pingShip(argo, { shipId: scoutId }));
    unwrap(await messagingUseCases(core).pushReceiveDeliveries(scoutCrew, {}));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'waiting' } });
  });

  it('is answered, with the moment of the pong', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const sentAt = core.clock.now();
    const { messageId } = unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    core.clock.advance(4_000);
    unwrap(await messaging.answerPing(scoutCrew, { deliveryId: deliveryIdOf(core, messageId) }));

    await expect(listedScout()).resolves.toMatchObject({
      ping: { state: 'answered', sentAt, answeredAt: core.clock.now() },
    });
  });

  it('is acknowledged, not answered with pong, after a plain ack', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const { messageId } = unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    unwrap(await messaging.acknowledgeDelivery(scoutCrew, { deliveryId: deliveryIdOf(core, messageId) }));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'acknowledged', answeredAt: null } });
  });

  it('is the newest ping: a new one waits again after an answered one', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const { messageId } = unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    unwrap(await messaging.answerPing(scoutCrew, { deliveryId: deliveryIdOf(core, messageId) }));
    core.clock.advance(60_000);
    const sentAt = core.clock.now();

    unwrap(await messaging.pingShip(argo, { shipId: scoutId }));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'waiting', sentAt } });
  });

  it('is undeliverable, from when it was sent, once the last ping went to the operator as undeliverable', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const sentAt = core.clock.now();
    unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    for (let claim = 1; claim <= 5; claim += 1) {
      unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    }

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'undeliverable', sentAt, answeredAt: null } });
  });

  it('is null once the operator dismissed the undeliverable ping', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const { messageId } = unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    for (let claim = 1; claim <= 5; claim += 1) {
      unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    }
    const ping = core.state.deliveries.find((delivery) => delivery.messageId === messageId);

    unwrap(await messaging.dismissDelivery(argo, { deliveryId: ping?.id ?? core.ids('delivery') }));

    await expect(listedScout()).resolves.toMatchObject({ ping: null });
  });
});

describe('the labels a ship carries, and selecting ships by them', () => {
  let builderId: ShipId;
  let testerId: ShipId;

  beforeEach(async () => {
    // argo labels the ships: it labels any ship (decision 0046).
    const plugin = argo;
    ({ shipId: builderId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
    ({ shipId: testerId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'implementer' })));
    unwrap(await useCases.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
    unwrap(await useCases.defineLabel(plugin, { key: 'project', values: ['hemma', 'aeolus'] }));
    unwrap(await useCases.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'project', value: 'hemma' }) }));
    unwrap(await useCases.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'os', value: 'macos' }) }));
    unwrap(await useCases.assignLabel(plugin, { shipId: testerId, valueId: valueIdOf(core, { key: 'os', value: 'macos' }) }));
    unwrap(await useCases.assignLabel(plugin, { shipId: testerId, valueId: valueIdOf(core, { key: 'os', value: 'linux' }) }));
    unwrap(await useCases.assignLabel(plugin, { shipId: scoutId, valueId: valueIdOf(core, { key: 'os', value: 'linux' }) }));
  });

  async function namesSelected(...values: [string, string][]) {
    return (await useCases.listFleet(argo, { valueIds: values.map(([key, value]) => valueIdOf(core, { key, value })) })).ships.map((ship) => ship.name);
  }

  it('lists each ship with the labels it carries, ids and text, by key then value, and none for a ship without', async () => {
    const listed = wholeShips((await useCases.listFleet(argo)).ships);

    expect(listed.map((ship) => [ship.name, ship.labels.map(({ key, value }) => `${key}=${value}`)])).toEqual([
      ['argo', []],
      ['builder', ['os=macos', 'project=hemma']],
      ['scout', ['os=linux']],
      ['tester', ['os=linux', 'os=macos']],
    ]);
    expect(listed.find((ship) => ship.name === 'scout')?.labels).toEqual([
      { labelId: labelIdOf(core, 'os'), key: 'os', valueId: valueIdOf(core, { key: 'os', value: 'linux' }), value: 'linux' },
    ]);
  });

  it('selects the ships that carry a value, by its id', async () => {
    await expect(namesSelected(['os', 'macos'])).resolves.toEqual(['builder', 'tester']);
  });

  it('selects by every value given at once: exact matches, combined with AND', async () => {
    await expect(namesSelected(['os', 'macos'], ['project', 'hemma'])).resolves.toEqual(['builder']);
    await expect(namesSelected(['os', 'macos'], ['os', 'linux'])).resolves.toEqual(['tester']);
  });

  it('selects no ship for a value no ship carries, or an id the fleet has no value for', async () => {
    await expect(namesSelected(['project', 'aeolus'])).resolves.toEqual([]);
    await expect(useCases.listFleet(argo, { valueIds: [core.ids('labelValue')] }).then((page) => page.ships)).resolves.toEqual([]);
  });

  it('lists every ship when it selects by no value', async () => {
    await expect(useCases.listFleet(argo, { valueIds: [] }).then((page) => page.ships)).resolves.toHaveLength(4);
  });
});

describe('listing the fleet within read reach (decision 0034)', () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('lists a ship outside read reach by its name, type and status only', async () => {
    const status = (await fleet.registry.listFleet(fleet.argo)).ships.find((ship) => ship.id === fleet.far.shipId)?.status;

    const listed = (await fleet.registry.listFleet(fleet.reader)).ships;

    expect(listed.find((ship) => ship.id === fleet.far.shipId)).toEqual({ id: fleet.far.shipId, name: 'far', type: 'keeper', status, isInReadReach: false });
  });

  it('lists a ship within read reach whole', async () => {
    const listed = (await fleet.registry.listFleet(fleet.reader)).ships;

    expect(listed.find((ship) => ship.id === fleet.near.shipId)).toEqual((await fleet.registry.listFleet(fleet.argo)).ships.find((ship) => ship.id === fleet.near.shipId));
  });

  it.each(['report', 'runsOn', 'seen'] as const)(
    'gives a ship outside read reach no %s to sort by, so the cursor after it holds only its name and id',
    async (column) => {
      const cursors = [];
      let cursor = undefined;
      do {
        const page = await fleet.registry.listFleet(fleet.reader, { sort: { column, direction: 'ascending' }, cursor, limit: 1 });
        cursor = page.nextCursor ?? undefined;
        cursors.push(cursor);
      } while (cursor !== undefined);

      expect(cursors.find((each) => each?.id === fleet.far.shipId)).toEqual({ isEmpty: true, value: '', name: 'far', id: fleet.far.shipId });
    },
  );

  it('never selects a ship outside read reach by its crew request or the harness crewing it', async () => {
    const names = async (input: Parameters<typeof fleet.registry.listFleet>[1]) => (await fleet.registry.listFleet(fleet.reader, input)).ships.map((ship) => ship.name);

    await expect(names({ crewRequest: ['none'] })).resolves.not.toContain('far');
    await expect(names({ kind: ['claudeCode'] })).resolves.not.toContain('far');
  });

  it('answers a label page without ships outside read reach, so it is not short of a match', async () => {
    const page = await fleet.registry.listFleet(fleet.reader, { valueIds: [fleet.team('b')], limit: 1 });

    expect(page).toEqual({ ships: [], nextCursor: null });
  });

  it('never matches a ship outside read reach by the label values it carries', async () => {
    const [byB, byA] = [(await fleet.registry.listFleet(fleet.reader, { valueIds: [fleet.team('b')] })).ships, (await fleet.registry.listFleet(fleet.reader, { valueIds: [fleet.team('a')] })).ships];

    expect([byB, byA.map((ship) => ship.id).sort()]).toEqual([[], [fleet.reader.shipId, fleet.near.shipId].sort()]);
  });
});

describe('a page of the fleet (decision 4 of the performance design)', () => {
  async function commissionShips(names: readonly string[]): Promise<ShipId[]> {
    const ids: ShipId[] = [];
    for (const name of names) {
      ids.push(unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'implementer' })).shipId);
    }
    return ids;
  }

  /** The names on every page, read on from each next cursor. */
  async function namesPaged(input: Parameters<typeof useCases.listFleet>[1] & { limit: number }): Promise<string[][]> {
    const pages: string[][] = [];
    let cursor = undefined;
    do {
      const page = await useCases.listFleet(argo, { ...input, cursor });
      pages.push(page.ships.map((ship) => ship.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return pages;
  }

  it('answers argo first, then the ships by name, a page at a time from each next cursor', async () => {
    await commissionShips(['tester', 'builder']);

    await expect(namesPaged({ limit: 2 })).resolves.toEqual([
      ['argo', 'builder'],
      ['scout', 'tester'],
    ]);
  });

  it('answers no next cursor when the last page holds exactly the page size', async () => {
    const page = await useCases.listFleet(argo, { limit: 2 });

    expect([page.ships.map((ship) => ship.name), page.nextCursor]).toEqual([['argo', 'scout'], null]);
  });

  it('holds 100 ships when the caller asks no page size', async () => {
    await commissionShips(Array.from({ length: 100 }, (_unused, index) => `ship-${String(index)}`));

    const page = await useCases.listFleet(argo);

    expect([page.ships.length, page.nextCursor === null]).toEqual([100, false]);
  });

  it('pages the ships that carry the label values given, so a page is never short of a match', async () => {
    const [builderId, , checkerId] = await commissionShips(['builder', 'tester', 'checker']);
    unwrap(await useCases.defineLabel(argo, { key: 'os', values: ['macos'] }));
    const macos = valueIdOf(core, { key: 'os', value: 'macos' });
    for (const shipId of [builderId, checkerId].filter((id) => id !== undefined)) {
      unwrap(await useCases.assignLabel(argo, { shipId, valueId: macos }));
    }

    await expect(namesPaged({ valueIds: [macos], limit: 1 })).resolves.toEqual([['builder'], ['checker']]);
  });

  it.each([
    { column: 'ship', direction: 'ascending', names: ['argo', 'builder', 'scout', 'tester'] },
    { column: 'ship', direction: 'descending', names: ['tester', 'scout', 'builder', 'argo'] },
    { column: 'status', direction: 'ascending', names: ['builder', 'scout', 'tester', 'argo'] },
    { column: 'status', direction: 'descending', names: ['argo', 'builder', 'scout', 'tester'] },
  ] as const)('sorts by $column $direction, ties by name, page after page', async ({ column, direction, names }) => {
    await commissionShips(['tester', 'builder']);

    await expect(namesPaged({ sort: { column, direction }, limit: 3 }).then((pages) => pages.flat())).resolves.toEqual(names);
  });

  it('sorts by where a ship runs, the ships no session crews last either way', async () => {
    const [testerId, builderId] = await commissionShips(['tester', 'builder']);
    crewShip(core, { fleetId, shipId: testerId ?? scoutId, harness: 'codex' });
    crewShip(core, { fleetId, shipId: builderId ?? scoutId });

    const ascending = await namesPaged({ sort: { column: 'runsOn', direction: 'ascending' }, limit: 2 });
    const descending = await namesPaged({ sort: { column: 'runsOn', direction: 'descending' }, limit: 2 });

    // claude-code, codex, console; scout runs nowhere.
    expect([ascending.flat(), descending.flat()]).toEqual([
      ['builder', 'tester', 'argo', 'scout'],
      ['argo', 'tester', 'builder', 'scout'],
    ]);
  });

  it('sorts by when a ship was last seen, the most recent first when ascending, the never seen last', async () => {
    const [testerId, builderId] = await commissionShips(['tester', 'builder']);
    crewShip(core, { fleetId, shipId: testerId ?? scoutId });
    core.clock.advance(60_000);
    crewShip(core, { fleetId, shipId: builderId ?? scoutId });

    await expect(namesPaged({ sort: { column: 'seen', direction: 'ascending' }, limit: 2 }).then((pages) => pages.flat())).resolves.toEqual([
      'builder',
      'tester',
      'argo',
      'scout',
    ]);
  });
});

describe('selecting the ships of a page by what the overview filters (decision 4 of the performance design)', () => {
  let builderId: ShipId;
  let testerId: ShipId;

  beforeEach(async () => {
    ({ shipId: builderId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
    ({ shipId: testerId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'tester' })));
    const { shipId: oldId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'reviewer' }));
    unwrap(await useCases.retireShip(argo, { shipId: oldId }));
  });

  async function namesSelected(input: Parameters<typeof useCases.listFleet>[1]) {
    return (await useCases.listFleet(argo, input)).ships.map((ship) => ship.name);
  }

  it('selects the ships whose name or type holds the search text, in any case', async () => {
    await expect(namesSelected({ query: 'REVIEW' })).resolves.toEqual(['scout']);
    await expect(namesSelected({ query: 'uild' })).resolves.toEqual(['builder']);
  });

  it('selects the active ship of the exact name given, never one whose name only holds it, nor a retired one', async () => {
    expect([await namesSelected({ name: 'builder' }), await namesSelected({ name: 'build' }), await namesSelected({ name: 'old' })]).toEqual([['builder'], [], []]);
  });

  it('selects the ships of any kind picked: argo and the person ships', async () => {
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'alice', type: 'person', kind: 'person' }));

    await expect(namesSelected({ shipKind: ['operator', 'person'] })).resolves.toEqual(['argo', 'alice']);
  });

  it('selects the ships of any status picked', async () => {
    await expect(namesSelected({ status: ['crewed', 'retired'] })).resolves.toEqual(['argo', 'old']);
  });

  it('selects the ships of any type picked', async () => {
    await expect(namesSelected({ type: ['implementer', 'tester'] })).resolves.toEqual(['builder', 'tester']);
  });

  it('selects the ships by where their crew request stands: none, needs crew or crewed by hand', async () => {
    unwrap(await useCases.requestCrew(argo, { shipId: builderId, settings: aCrewSettings() }));
    unwrap(await useCases.requestCrew(argo, { shipId: testerId, settings: aCrewSettings() }));
    crewShip(core, { fleetId, shipId: testerId });

    await expect(namesSelected({ crewRequest: ['needsCrew'] })).resolves.toEqual(['builder']);
    await expect(namesSelected({ crewRequest: ['crewedByHand'] })).resolves.toEqual(['tester']);
    await expect(namesSelected({ crewRequest: ['none'] })).resolves.toEqual(['argo', 'scout']);
  });

  it("selects the ships by the status their trierarch wrote, an assigned request without one as crewing", async () => {
    const plugin = await shipWithScopes({ registry: useCases, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
    const trierarch = await shipWithScopes({ registry: useCases, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    for (const shipId of [builderId, testerId]) {
      unwrap(await useCases.requestCrew(argo, { shipId, settings: aCrewSettings() }));
      unwrap(await useCases.assignCrew(plugin, { shipId, trierarchShipId: trierarch.shipId }));
    }
    unwrap(await useCases.reportCrewStatus(trierarch, { shipId: testerId, status: 'crashed' }));

    await expect(namesSelected({ crewRequest: ['crashed'] })).resolves.toEqual(['tester']);
    await expect(namesSelected({ crewRequest: ['crewing'] })).resolves.toEqual(['builder']);
  });

  it('selects the ships needing crew, as the trierarch plugin being connected decides', async () => {
    const plugin = await shipWithScopes({ registry: useCases, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
    const trierarch = await shipWithScopes({ registry: useCases, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    unwrap(await useCases.requestCrew(argo, { shipId: builderId, settings: aCrewSettings() }));
    unwrap(await useCases.requestCrew(argo, { shipId: testerId, settings: aCrewSettings() }));
    unwrap(await useCases.assignCrew(plugin, { shipId: testerId, trierarchShipId: trierarch.shipId }));
    unwrap(await useCases.reportCrewStatus(trierarch, { shipId: testerId, status: 'crashed' }));

    await expect(namesSelected({ needsCrew: 'withoutTrierarchs' })).resolves.toEqual(['builder']);
    await expect(namesSelected({ needsCrew: 'withTrierarchs' })).resolves.toEqual(['builder', 'tester']);
  });

  it('sorts by when crew was requested, the oldest request first, ships without one last', async () => {
    unwrap(await useCases.requestCrew(argo, { shipId: testerId, settings: aCrewSettings() }));
    core.clock.advance(60_000);
    unwrap(await useCases.requestCrew(argo, { shipId: builderId, settings: aCrewSettings() }));

    await expect(namesSelected({ sort: { column: 'requested', direction: 'ascending' } })).resolves.toEqual(['tester', 'builder', 'argo', 'scout']);
  });

  it('selects the ships whose crew request is assigned to any trierarch given', async () => {
    const plugin = await shipWithScopes({ registry: useCases, argo }, { name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] });
    const mac = await shipWithScopes({ registry: useCases, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    const linux = await shipWithScopes({ registry: useCases, argo }, { name: 'linux-box', type: 'trierarch', scopes: ['crew:run'] });
    for (const [shipId, trierarchShipId] of [[builderId, mac.shipId], [testerId, linux.shipId]] as const) {
      unwrap(await useCases.requestCrew(argo, { shipId, settings: aCrewSettings() }));
      unwrap(await useCases.assignCrew(plugin, { shipId, trierarchShipId }));
    }

    await expect(namesSelected({ assignedTo: [mac.shipId] })).resolves.toEqual(['builder']);
    await expect(namesSelected({ assignedTo: [mac.shipId, linux.shipId] })).resolves.toEqual(['builder', 'tester']);
  });

  it('combines the filters with AND, and fills a page with matches only', async () => {
    const page = await useCases.listFleet(argo, { query: 'r', status: ['awaitingCrew'], type: ['reviewer', 'implementer'], limit: 1 });
    const next = await useCases.listFleet(argo, { query: 'r', status: ['awaitingCrew'], type: ['reviewer', 'implementer'], cursor: page.nextCursor ?? undefined, limit: 1 });

    expect([page.ships.map((ship) => ship.name), next.ships.map((ship) => ship.name), next.nextCursor]).toEqual([['builder'], ['scout'], null]);
  });

  it('selects the ships given by id: a squadron the console resolved', async () => {
    await expect(namesSelected({ shipIds: [testerId, scoutId] })).resolves.toEqual(['scout', 'tester']);
  });

  it.each([
    ['console', ['argo']],
    ['plugin', []],
    ['trierarch', ['mac-mini']],
    ['codex', ['tester']],
    ['other', ['builder', 'scout']],
  ] as const)('selects the ships whose agent kind is %s', async (kind, names) => {
    await shipWithScopes({ registry: useCases, argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
    crewShip(core, { fleetId, shipId: testerId, harness: 'codex' });

    await expect(namesSelected({ kind: [kind] })).resolves.toEqual(names);
  });

  it('selects as plugin the ships the console says its plugins run as, before their type or harness', async () => {
    const pluginShip = await shipWithScopes({ registry: useCases, argo }, { name: 'squadrons', type: 'trierarch', scopes: [] });

    await expect(namesSelected({ kind: ['plugin'], pluginShipIds: [pluginShip.shipId] })).resolves.toEqual(['squadrons']);
    await expect(namesSelected({ kind: ['trierarch'], pluginShipIds: [pluginShip.shipId] })).resolves.toEqual([]);
  });
});
