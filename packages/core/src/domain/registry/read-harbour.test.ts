import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addViewerShip, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import type { HarbourFilter } from './read-harbour.js';

/**
 * The read Harbour needs (docs/design/fleet-overview): every active ship the
 * caller reads whole, by id, name, kind, its state and note, in the listing
 * order, a page at a time, with the five numbers on the first page; or only
 * the ships asked, for a live reload of their tiles.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-01T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
});

async function commission(name: string, type = 'builder'): Promise<ShipId> {
  return unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

async function crewed(name: string): Promise<Crew> {
  return crewAboard(core, { fleetId, shipId: await commission(name) });
}

async function raiseAlertOn(shipId: ShipId): Promise<void> {
  const deliveryId = 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1';
  unwrap(
    await registry.raiseAlert(argo, {
      shipId,
      signal: 'delivery-unacknowledged',
      occurrenceKey: deliveryId,
      since: '2026-11-01T11:45:00.000Z',
      facts: { deliveryId, messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
    }),
  );
}

/** A fleet of argo, builder working, planner blocked, scout idle, walker awaiting crew, deploy-bot with an alert, old retired and the viewer ship. */
async function aFleet(): Promise<{ builder: Crew }> {
  const builder = await crewed('builder');
  unwrap(await registry.report(builder, { state: 'working', note: 'Building the harbour' }));
  unwrap(await registry.report(await crewed('planner'), { state: 'blocked', note: 'Waiting for a review' }));
  unwrap(await registry.report(await crewed('scout'), { state: 'idle' }));
  await commission('walker');
  await raiseAlertOn(await commission('deploy-bot'));
  unwrap(await registry.retireShip(argo, { shipId: await commission('old') }));
  addViewerShip(core, { fleetId });
  return { builder };
}

describe("reading Harbour's ships", () => {
  it('answers each active ship the caller reads, argo first and then by name, with its kind, state and note, and leaves out retired ships and the viewer ship', async () => {
    await aFleet();

    const harbour = await registry.readHarbour(argo);

    expect(harbour.ships.map(({ name, kind, state, note }) => ({ name, kind, state, note }))).toEqual([
      { name: 'argo', kind: 'operator', state: 'idle', note: null },
      { name: 'builder', kind: 'agent', state: 'working', note: 'Building the harbour' },
      { name: 'deploy-bot', kind: 'agent', state: 'alert', note: null },
      { name: 'planner', kind: 'agent', state: 'waiting', note: 'Waiting for a review' },
      { name: 'scout', kind: 'agent', state: 'idle', note: null },
      { name: 'walker', kind: 'agent', state: 'waiting', note: null },
    ]);
  });

  it('counts the ships it answers, and how many are in each state, on the first page', async () => {
    await aFleet();

    const { counts } = await registry.readHarbour(argo);

    expect(counts).toEqual({ ships: 6, alert: 1, waiting: 2, working: 1, idle: 2 });
  });

  it('answers a page of the size asked and where the next starts, the numbers on the first page only, until the last page', async () => {
    await aFleet();

    const first = await registry.readHarbour(argo, { limit: 4 });
    const last = await registry.readHarbour(argo, { limit: 4, cursor: first.nextCursor ?? undefined });

    expect([first.ships.length, first.counts?.ships, last.ships.map((ship) => ship.name), last.counts, last.nextCursor]).toEqual([4, 6, ['scout', 'walker'], null, null]);
  });

  it('answers only the ships asked, for a live reload of their tiles, with no numbers and no next page, and none for a retired ship', async () => {
    const { builder } = await aFleet();
    const old = core.state.ships.find((ship) => ship.name === 'old');

    const harbour = await registry.readHarbour(argo, { shipIds: [builder.shipId, ...(old ? [old.id] : [])] });

    expect([harbour.ships.map((ship) => ship.name), harbour.counts, harbour.nextCursor]).toEqual([['builder'], null, null]);
  });

  it("leaves out the ships outside the caller's read reach (decision 0034)", async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();

    const reader = await fleet.registry.readHarbour(fleet.reader);
    const whole = (await fleet.registry.listFleet(fleet.reader)).ships.filter((ship) => !('isInReadReach' in ship) && ship.kind !== 'viewer');

    expect(reader.ships.map((ship) => ship.id)).toEqual(whole.map((ship) => ship.id));
    expect(reader.counts?.ships).toBe(whole.length);
  });

  // The fleet overview's bar (#1605): search, State, Type and Labels filter the tiles; the numbers stay the whole fleet.
  describe("filtered by the overview's bar", () => {
    async function namesOf(filter: HarbourFilter) {
      const harbour = await registry.readHarbour(argo, { filter });
      return { names: harbour.ships.map((ship) => ship.name), counts: harbour.counts };
    }

    it('answers only the ships the filter selects, and still counts the whole fleet', async () => {
      await aFleet();

      const read = await namesOf({ state: ['waiting', 'alert'] });

      expect(read).toEqual({ names: ['deploy-bot', 'planner', 'walker'], counts: { ships: 6, alert: 1, waiting: 2, working: 1, idle: 2 } });
    });

    it('selects by the search in the name, by type and by every label value picked, combined', async () => {
      await aFleet();
      await commission('reviewer-1', 'reviewer');
      const reviewer2 = await commission('reviewer-2', 'reviewer');
      const { values } = unwrap(await registry.defineLabel(argo, { key: 'team', values: ['core'] }));
      const teamCore = values[0]?.id;
      if (teamCore !== undefined) {
        unwrap(await registry.assignLabel(argo, { shipId: reviewer2, valueId: teamCore }));
      }

      const [bySearch, byType, byLabel] = [await namesOf({ nameQuery: 'PLAN' }), await namesOf({ type: ['reviewer'], state: ['waiting'] }), await namesOf({ valueIds: teamCore === undefined ? [] : [teamCore] })];

      expect([bySearch.names, byType.names, byLabel.names]).toEqual([['planner'], ['reviewer-1', 'reviewer-2'], ['reviewer-2']]);
    });

    it('reloads a ship asked only while the filter still selects it', async () => {
      const { builder } = await aFleet();

      const [selected, dropped] = [
        await registry.readHarbour(argo, { shipIds: [builder.shipId], filter: { state: ['working'] } }),
        await registry.readHarbour(argo, { shipIds: [builder.shipId], filter: { state: ['idle'] } }),
      ];

      expect([selected.ships.map((ship) => ship.name), dropped.ships]).toEqual([['builder'], []]);
    });
  });

  describe("a ship's last activity", () => {
    async function lastActivityOf(name: string): Promise<Date | null | undefined> {
      return (await registry.readHarbour(argo)).ships.find((ship) => ship.name === name)?.lastActivityAt;
    }

    it('is none for a ship that has done nothing yet', async () => {
      await crewed('scout');

      await expect(lastActivityOf('scout')).resolves.toBeNull();
    });

    it('is the time of its latest send', async () => {
      const scout = await crewed('scout');
      core.clock.advance(60_000);
      unwrap(await messagingUseCases(core).sendMessage(scout, { selector: { kind: 'ship', name: 'argo' }, payload: 'Done', contentType: 'text/plain', idempotencyKey: newKey(), model: 'claude-opus-5-5' }));
      const sentAt = core.clock.now();
      core.clock.advance(60_000);

      await expect(lastActivityOf('scout')).resolves.toEqual(sentAt);
    });

    it('is the time of its latest acknowledgement, when that is later than its sends', async () => {
      const scout = await crewed('scout');
      const messaging = messagingUseCases(core);
      unwrap(await messaging.sendMessage(argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: 'Review', contentType: 'text/plain', idempotencyKey: newKey() }));
      const { deliveries } = unwrap(await messaging.receiveDeliveries(scout, {}));
      core.clock.advance(60_000);
      const [delivery] = deliveries;
      expect(delivery).toBeDefined();
      if (delivery !== undefined) {
        unwrap(await messaging.acknowledgeDelivery(scout, { deliveryId: delivery.deliveryId }));
      }

      await expect(lastActivityOf('scout')).resolves.toEqual(core.clock.now());
    });

    it('is the activity its trierarch reported, when that is the latest', async () => {
      const scout = await crewed('scout');
      core.clock.advance(60_000);
      unwrap(await messagingUseCases(core).sendMessage(scout, { selector: { kind: 'ship', name: 'argo' }, payload: 'Done', contentType: 'text/plain', idempotencyKey: newKey(), model: 'claude-opus-5-5' }));
      core.clock.advance(60_000);
      const observedAt = core.clock.now();
      core.state.leaseActivities.push({ fleetId, leaseId: scout.leaseId, activity: { at: observedAt, kind: 'tool', tool: 'Bash', reportedAt: observedAt, intervalSeconds: 60 } });

      await expect(lastActivityOf('scout')).resolves.toEqual(observedAt);
    });

    it("is not moved by another ship's send to it", async () => {
      const scout = await crewed('scout');
      core.clock.advance(60_000);
      unwrap(await messagingUseCases(core).sendMessage(argo, { selector: { kind: 'ship', shipId: scout.shipId }, payload: 'Review', contentType: 'text/plain', idempotencyKey: newKey() }));

      await expect(lastActivityOf('scout')).resolves.toBeNull();
    });
  });
});
