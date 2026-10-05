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
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

const commissionedAt = new Date('2026-09-29T12:00:00.000Z');

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
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

async function listedScout() {
  return (await useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
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

    await expect(listedScout()).resolves.toMatchObject({ awaitingCrewSince: null });
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
    const [listedArgo] = await useCases.listFleet(argo);

    expect(listedArgo?.model).toBeNull();
    await expect(listedScout()).resolves.toMatchObject({ model: null });
  });
});

describe('listing the fleet', () => {
  it('lists every ship in the order commissioned, argo first and without a prompt, with name, type, kind, status, prompt state and no location while awaiting crew', async () => {
    await expect(useCases.listFleet(argo)).resolves.toEqual([
      {
        id: argoId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        status: 'awaitingCrew',
        startingPrompt: null,
        location: null,
        lastSeenAt: null,
        ping: null,
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
        report: null,
        harness: null,
        model: null,
        awaitingCrewSince: commissionedAt,
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
        harness: null,
        model: null,
        awaitingCrewSince: commissionedAt,
      },
    ]);
  });

  it('shows argo crewed from the device the operator signed in on', async () => {
    unwrap(await identityUseCases(core).signIn({ ...OPERATOR, device: 'Mac · Chrome' }));

    const [listedArgo] = await useCases.listFleet(argo);

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

    await expect(listedScout()).resolves.toMatchObject({ status: 'retired' });
  });

  it("lists only the caller's fleet", async () => {
    const elsewhere = { ...argo, fleetId: core.ids('fleet') };

    await expect(useCases.listFleet(elsewhere)).resolves.toEqual([]);
  });

  it('never carries a secret or its hash', async () => {
    const listed = JSON.stringify(await useCases.listFleet(argo));

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

  it('is received, not answered with pong, after a plain ack', async () => {
    const scoutCrew = await crewedScout();
    const messaging = messagingUseCases(core);
    const { messageId } = unwrap(await messaging.pingShip(argo, { shipId: scoutId }));
    unwrap(await messaging.receiveDeliveries(scoutCrew, {}));
    unwrap(await messaging.acknowledgeDelivery(scoutCrew, { deliveryId: deliveryIdOf(core, messageId) }));

    await expect(listedScout()).resolves.toMatchObject({ ping: { state: 'received', answeredAt: null } });
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
