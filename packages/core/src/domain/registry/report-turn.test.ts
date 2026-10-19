import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller, Crew } from '../shared/caller.js';
import { ok } from '../shared/result.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-12T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

/** A moment `seconds` before the clock's now: when the hook saw the turn change. */
function secondsAgo(seconds: number): Date {
  return new Date(core.clock.now().getTime() - seconds * 1_000);
}

function storedTurn() {
  return core.state.leaseTurns.find((held) => held.leaseId === scout.leaseId)?.turn;
}

function turnEvents() {
  return core.state.events.filter((event) => event.type === 'TurnReported');
}

describe('a turn report', () => {
  it('keeps the turn with the lease, at the time the hook saw it', async () => {
    const at = secondsAgo(2);

    await expect(useCases.reportTurn(scout, { turn: 'busy', at })).resolves.toEqual(ok(undefined));
    expect(storedTurn()).toEqual({ state: 'busy', at });
  });

  it('writes TurnReported at its own time, caused by the ship, with its lease and turn', async () => {
    const at = secondsAgo(2);

    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at }));

    const [event] = turnEvents();
    expect(turnEvents()).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'TurnReported',
        occurredAt: at,
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        details: { leaseId: scout.leaseId, turn: 'busy' },
      },
    ]);
  });

  it('keeps the time of a late report: a report the fleet refused while busy is sent again later', async () => {
    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at: secondsAgo(600) }));
    const at = secondsAgo(30);

    unwrap(await useCases.reportTurn(scout, { turn: 'idle', at }));

    expect(storedTurn()).toEqual({ state: 'idle', at });
    expect(turnEvents().map((event) => [event.details.turn, event.occurredAt])).toEqual([
      ['busy', secondsAgo(600)],
      ['idle', at],
    ]);
  });

  it('changes nothing for the same turn again: idle stays idle since it turned idle', async () => {
    const since = secondsAgo(60);
    unwrap(await useCases.reportTurn(scout, { turn: 'idle', at: since }));
    core.state.events.length = 0;

    await expect(useCases.reportTurn(scout, { turn: 'idle', at: secondsAgo(5) })).resolves.toEqual(ok(undefined));
    expect(storedTurn()).toEqual({ state: 'idle', at: since });
    expect(turnEvents()).toEqual([]);
  });

  it('changes nothing for a report older than the turn it holds: a late report never undoes a newer one', async () => {
    const at = secondsAgo(10);
    unwrap(await useCases.reportTurn(scout, { turn: 'idle', at }));
    core.state.events.length = 0;

    await expect(useCases.reportTurn(scout, { turn: 'busy', at: secondsAgo(11) })).resolves.toEqual(ok(undefined));
    expect(storedTurn()).toEqual({ state: 'idle', at });
    expect(turnEvents()).toEqual([]);
  });

  it('takes a report at the same time as the turn it holds', async () => {
    const at = secondsAgo(10);
    unwrap(await useCases.reportTurn(scout, { turn: 'idle', at }));

    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at }));

    expect(storedTurn()).toEqual({ state: 'busy', at });
  });

  it('takes a time later than now as now: a turn never changes in the future', async () => {
    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at: new Date(core.clock.now().getTime() + 60_000) }));

    expect(storedTurn()).toEqual({ state: 'busy', at: core.clock.now() });
    expect(turnEvents()).toMatchObject([{ occurredAt: core.clock.now() }]);
  });

  it('is refused once the lease ended, and keeps nothing', async () => {
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    await expect(useCases.reportTurn(scout, { turn: 'busy', at: secondsAgo(1) })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LEASE_ENDED' },
    });
    expect(storedTurn()).toBeUndefined();
    expect(turnEvents()).toEqual([]);
  });
});
