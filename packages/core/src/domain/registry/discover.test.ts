import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addViewerShip, crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { unwrap } from '../../testing/result.js';
import type { Caller, Crew } from '../shared/caller.js';

/**
 * Discovery (decision 0047): planner asks which ships it may send to now.
 * scout and vault are reviewers, scout crewed and vault awaiting crew with a
 * commission note; a retired ship and the viewer are never answered.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let planner: Crew;
let scoutId: ShipId;
let scout: Crew;

async function commissioned(name: string, input: { type?: string; note?: string } = {}): Promise<ShipId> {
  return unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: input.type ?? name, ...(input.note === undefined ? {} : { note: input.note }) })).shipId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  planner = crewAboard(core, { fleetId, shipId: await commissioned('planner') });
  scoutId = await commissioned('scout', { type: 'reviewer' });
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  await commissioned('vault', { type: 'reviewer', note: 'Keeps the release keys' });
  const retiredId = await commissioned('old-scout', { type: 'reviewer' });
  unwrap(await registry.retireShip(argo, { shipId: retiredId }));
  addViewerShip(core, { fleetId });
  core.state.events.length = 0;
});

/** Sets the rules as the networking plugin does, open for send off: tier=public ships are the only ones a send rule reaches. */
async function onlyPublicReached(): Promise<void> {
  const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.defineLabel(argo, { key: 'tier', values: ['public'] }));
  const isPublic = valueIdOf(core, { key: 'tier', value: 'public' });
  unwrap(await registry.assignLabel(argo, { shipId: scoutId, valueId: isPublic }));
  unwrap(await registry.registerNetworkPlugin(networking, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 }));
  unwrap(
    await registry.setNetworkRules(networking, {
      rules: [
        { verb: 'send', from: [], to: [isPublic] },
        { verb: 'read', from: [], to: [] },
        { verb: 'manage', from: [], to: [] },
      ],
    }),
  );
  unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'send', isOn: false }));
  core.state.events.length = 0;
}

describe('discovery (decision 0047)', () => {
  it('answers every other ship while open is on, with its name, type, kind and status: not the caller, the viewer or a retired ship', async () => {
    const { ships } = unwrap(await registry.discover(planner));

    expect(ships.map(({ name, type, kind, status }) => ({ name, type, kind, status }))).toEqual([
      { name: 'argo', type: 'operator', kind: 'operator', status: 'crewed' },
      { name: 'scout', type: 'reviewer', kind: 'agent', status: 'crewed' },
      { name: 'vault', type: 'reviewer', kind: 'agent', status: 'awaitingCrew' },
    ]);
  });

  it('counts per type how many of its ships the caller reaches', async () => {
    expect(unwrap(await registry.discover(planner)).types).toEqual([
      { type: 'operator', reachable: 1 },
      { type: 'reviewer', reachable: 2 },
    ]);
  });

  it('answers only the ships a send rule or a built-in rule lets it reach, a read or manage rule reaching none', async () => {
    await onlyPublicReached();

    const discovered = unwrap(await registry.discover(planner));

    expect(discovered.ships.map((ship) => ship.name)).toEqual(['argo', 'scout']);
    expect(discovered.types).toEqual([
      { type: 'operator', reachable: 1 },
      { type: 'reviewer', reachable: 1 },
    ]);
  });

  it('answers argo every ship, as argo reaches every ship', async () => {
    await onlyPublicReached();

    expect(unwrap(await registry.discover(argo)).ships.map((ship) => ship.name)).toEqual(['planner', 'scout', 'vault', 'networking']);
  });

  it("shows the crew's statement while one is stated, else the commission note, else none", async () => {
    unwrap(await registry.setStatement(scout, { summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr' }] }));

    const statements = Object.fromEntries(unwrap(await registry.discover(planner)).ships.map((ship) => [ship.name, ship.statement]));

    expect(statements).toEqual({
      argo: null,
      scout: { by: 'crew', version: 1, summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr' }] },
      vault: { by: 'commission', note: 'Keeps the release keys' },
    });
  });

  it('records nothing: no event and no refusal, whatever it leaves out', async () => {
    await onlyPublicReached();

    unwrap(await registry.discover(planner));

    expect(core.state.events).toEqual([]);
    expect(core.state.reachRefusals).toEqual([]);
  });
});
