import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewShip,
  identityUseCases,
  initialiseFleet,
  OPERATOR,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

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
  const commissioned = unwrap(await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  scoutSecret = secretIn(commissioned.prompt);
  core.clock.advance(60_000);
});

async function listedScout() {
  return (await useCases.listFleet(argo)).find((ship) => ship.id === scoutId);
}

function scout() {
  return core.state.ships.find((ship) => ship.id === scoutId);
}

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
      },
      {
        id: scoutId,
        name: 'scout',
        type: 'reviewer',
        kind: 'agent',
        status: 'awaitingCrew',
        startingPrompt: { issuedAt: commissionedAt, isClaimed: false },
        location: null,
      },
    ]);
  });

  it('shows argo crewed from the web console once the operator signs in', async () => {
    unwrap(await identityUseCases(core).signIn(OPERATOR));

    const [listedArgo] = await useCases.listFleet(argo);

    expect(listedArgo).toMatchObject({ status: 'crewed', location: { kind: 'OTHER', description: 'web console' } });
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
        location: { kind: 'OTHER', description: 'a ci runner' },
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
