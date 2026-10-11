import { LABEL_VALUES_MAX, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeManagementFleet, FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { fakeNetworkFleet, OTHER_OWNER } from '../../../test/support/network-fakes.js';
import type { OperatorNotices } from '../squadron/ports.js';
import type { Member, Squadron, SquadronState } from '../squadron/squadron.js';
import { createLabelSquadrons } from './label-squadrons.js';

const AT = new Date('2026-10-11T12:00:00.000Z');
const REPO = 'example.com/templates';

/** A ship id the fake fleet tells apart by its number. */
function shipIdOf(number: number): ShipId {
  return `shp_01m3tbfspe96yf1rnr4ank${String(number).padStart(4, '0')}`;
}

function aMember(shipId: ShipId, retiredAt: Date | null = null): Member {
  return { shipId, name: 'planner-k3x9', role: 'planner', type: 'team:planner', onStationAt: AT, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt, releasingSince: null, parameters: {} };
}

/** A squadron numbered n: its flagship is ship 100n, its members 100n+1 and up. */
function aSquadron(n: number, { state = 'sailing', members = 1 }: { state?: SquadronState; members?: number } = {}): Squadron {
  return {
    id: `team-${String(n)}`,
    fleetId: FLEET_ID,
    state,
    blueprint: { repository: REPO, name: 'team', version: 1, file: 'squadrons/team.yaml', commit: 'b1', committedAt: AT, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
    templates: [],
    flagship: { shipId: shipIdOf(100 * n), name: `team-${String(n)}`, crewToken: `aeolus_ct_v1_flagship_${String(n)}` },
    members: Array.from({ length: members }, (_, index) => aMember(shipIdOf(100 * n + index + 1))),
    formedAt: AT,
    sailedAt: AT,
  };
}

const CREW_TOKEN = 'aeolus_ct_v1_squadrons';

let management: ReturnType<typeof fakeManagementFleet>;
let fleet: ReturnType<typeof fakeNetworkFleet>;
let held: Squadron[];
let told: { fleetId: FleetId; text: string; key: string }[];
let labelSquadrons: ReturnType<typeof createLabelSquadrons>;

/** The fleet's ships: squadrons' own, and every ship of the squadrons held, not retired. */
function shipsOfTheFleet(): void {
  const ids = [SHIP_ID, ...held.flatMap((squadron) => [squadron.flagship.shipId, ...squadron.members.filter((member) => member.retiredAt === null).map((member) => member.shipId)])];
  fleet.state.ships = ids.map((shipId) => ({ shipId, labels: [] }));
}

/** The values a ship carries, as `key=value`. */
function carried(shipId: ShipId): string[] {
  const ship = fleet.state.ships.find((each) => each.shipId === shipId);
  return (ship?.labels ?? [])
    .map(({ labelId, valueId }) => {
      const label = fleet.state.labels.find((each) => each.labelId === labelId);
      return `${label?.key ?? '?'}=${label?.values.find((value) => value.valueId === valueId)?.value ?? '?'}`;
    })
    .sort();
}

function valuesOf(key: string): string[] | undefined {
  return fleet.state.labels.find((label) => label.key === key)?.values.map((value) => value.value);
}

beforeEach(async () => {
  management = fakeManagementFleet();
  management.state.scopes.push('labels:define', 'labels:assign');
  management.state.liveTokens.add(CREW_TOKEN);
  fleet = fakeNetworkFleet(management.state.liveTokens);
  const store = memoryManagementStore();
  await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: CREW_TOKEN, crewedAt: AT });
  held = [aSquadron(1, { members: 2 })];
  told = [];
  const operator: OperatorNotices = {
    tell: (notice) => {
      if (!told.some((each) => each.key === notice.key)) {
        told.push(notice);
      }
      return Promise.resolve();
    },
  };
  labelSquadrons = createLabelSquadrons({
    door: fleet.door,
    fleetDoor: management.door,
    management: store,
    squadrons: { list: (fleetId) => Promise.resolve(fleetId === FLEET_ID ? held : []) },
    operator,
  });
  shipsOfTheFleet();
});

describe('squadrons labelling its squadrons (#573)', () => {
  it('defines squadron with a value per squadron, and squadron-role with flagship and squadrons', async () => {
    await labelSquadrons(FLEET_ID);

    expect(valuesOf('squadron')).toEqual(['team-1']);
    expect(valuesOf('squadron-role')).toEqual(['flagship', 'squadrons']);
  });

  it("labels its own ship squadron-role=squadrons, and no squadron", async () => {
    await labelSquadrons(FLEET_ID);

    expect(carried(SHIP_ID)).toEqual(['squadron-role=squadrons']);
  });

  it("labels a squadron's flagship with its squadron and squadron-role=flagship", async () => {
    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(100))).toEqual(['squadron-role=flagship', 'squadron=team-1']);
  });

  it("labels each member of a squadron with its squadron, and no role", async () => {
    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(101))).toEqual(['squadron=team-1']);
    expect(carried(shipIdOf(102))).toEqual(['squadron=team-1']);
  });

  it('labels a squadron that stands down, as it still serves', async () => {
    held = [aSquadron(1, { state: 'standing-down' })];

    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(101))).toEqual(['squadron=team-1']);
  });

  it('says what it did, and writes nothing again once every ship carries its labels', async () => {
    await expect(labelSquadrons(FLEET_ID)).resolves.toEqual({ isOk: true, value: { defined: 2, valuesChanged: 0, assigned: 5, unassigned: 0, unlabelled: [] } });
    const writes = fleet.state.labelWrites.length;

    await expect(labelSquadrons(FLEET_ID)).resolves.toEqual({ isOk: true, value: { defined: 0, valuesChanged: 0, assigned: 0, unassigned: 0, unlabelled: [] } });
    expect(fleet.state.labelWrites).toHaveLength(writes);
  });

  it('adds a value for a squadron formed later, keeping the ids of the others', async () => {
    await labelSquadrons(FLEET_ID);
    const before = fleet.state.labels.find((label) => label.key === 'squadron')?.values[0];
    held = [...held, aSquadron(2)];
    fleet.state.ships.push({ shipId: shipIdOf(200), labels: [] }, { shipId: shipIdOf(201), labels: [] });

    await labelSquadrons(FLEET_ID);

    expect(fleet.state.labels.find((label) => label.key === 'squadron')?.values).toEqual([before, expect.objectContaining({ value: 'team-2' })]);
    expect(carried(shipIdOf(201))).toEqual(['squadron=team-2']);
  });

  it('labels no member squadrons retired', async () => {
    held = [{ ...aSquadron(1), members: [aMember(shipIdOf(101)), aMember(shipIdOf(102), AT)] }];

    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(102))).toEqual([]);
  });

  it('labels no ship of a disbanded squadron, and removes its value once no ship carries it', async () => {
    await labelSquadrons(FLEET_ID);
    held = [{ ...aSquadron(1), state: 'disbanded' }, aSquadron(2)];
    const own = fleet.state.ships.find((ship) => ship.shipId === SHIP_ID)?.labels ?? [];
    fleet.state.ships = [{ shipId: SHIP_ID, labels: own }, { shipId: shipIdOf(200), labels: [] }, { shipId: shipIdOf(201), labels: [] }];

    await labelSquadrons(FLEET_ID);

    expect(valuesOf('squadron')).toEqual(['team-2']);
  });

  it("keeps a disbanded squadron's value while a ship still carries it", async () => {
    await labelSquadrons(FLEET_ID);
    held = [{ ...aSquadron(1, { members: 2 }), state: 'disbanded' }, aSquadron(2)];
    fleet.state.ships.push({ shipId: shipIdOf(200), labels: [] }, { shipId: shipIdOf(201), labels: [] });

    await labelSquadrons(FLEET_ID);

    expect(valuesOf('squadron')).toEqual(['team-1', 'team-2']);
    expect(carried(shipIdOf(101))).toEqual(['squadron=team-1']);
  });

  it('takes a value of its labels off a ship that should not carry it', async () => {
    await labelSquadrons(FLEET_ID);
    held = [...held, aSquadron(2)];
    const flagship = fleet.state.ships.find((ship) => ship.shipId === shipIdOf(100))?.labels ?? [];
    fleet.state.ships = [...fleet.state.ships.filter((ship) => ship.shipId !== shipIdOf(100)), { shipId: shipIdOf(201), labels: flagship }, { shipId: shipIdOf(200), labels: [] }];

    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(201))).toEqual(['squadron=team-2']);
  });

  it('leaves alone a key another ship owns, and labels with the one it owns', async () => {
    fleet.state.labels.push({ labelId: 'lbl_01m3tbfspe96yf1rnr4ank9zzz', key: 'squadron-role', values: [{ valueId: 'lbv_01m3tbfspe96yf1rnr4ank9zzz', value: 'flagship' }], ownerShipId: OTHER_OWNER });

    await labelSquadrons(FLEET_ID);

    expect(fleet.state.labelWrites.filter((write) => write.includes('squadron-role'))).toEqual([]);
    expect(carried(shipIdOf(100))).toEqual(['squadron=team-1']);
  });

  it('defines no squadron label while the fleet has no squadron to label: a label needs a value', async () => {
    held = [];

    await labelSquadrons(FLEET_ID);

    expect(valuesOf('squadron')).toBeUndefined();
    expect(carried(SHIP_ID)).toEqual(['squadron-role=squadrons']);
  });

  it(`labels ${String(LABEL_VALUES_MAX)} squadrons, as many values as a label has`, async () => {
    held = Array.from({ length: LABEL_VALUES_MAX }, (_, index) => aSquadron(index + 1, { members: 0 }));
    shipsOfTheFleet();

    await expect(labelSquadrons(FLEET_ID)).resolves.toMatchObject({ isOk: true, value: { unlabelled: [] } });
    expect(valuesOf('squadron')).toHaveLength(LABEL_VALUES_MAX);
    expect(told).toEqual([]);
  });

  it('leaves a squadron over the limit unlabelled, and tells argo once, as its ships lose their reach', async () => {
    held = Array.from({ length: LABEL_VALUES_MAX + 1 }, (_, index) => aSquadron(index + 1, { members: 0 }));
    shipsOfTheFleet();
    const last = `team-${String(LABEL_VALUES_MAX + 1)}`;

    await expect(labelSquadrons(FLEET_ID)).resolves.toMatchObject({ isOk: true, value: { unlabelled: [last] } });
    await labelSquadrons(FLEET_ID);

    expect(carried(shipIdOf(100 * (LABEL_VALUES_MAX + 1)))).toEqual(['squadron-role=flagship']);
    expect(told).toEqual([{ fleetId: FLEET_ID, key: `unlabelled-${last}`, text: expect.stringContaining(last) }]);
  });

  it('labels nothing without the label scopes, and says why', async () => {
    management.state.scopes = management.state.scopes.filter((scope) => scope !== 'labels:assign');

    await expect(labelSquadrons(FLEET_ID)).resolves.toMatchObject({ isOk: true, value: { assigned: 0, skipped: expect.stringContaining('label scopes') } });
    expect(fleet.state.labelWrites).toEqual([]);
  });

  it('is refused for a fleet it is not connected to', async () => {
    await expect(labelSquadrons(OTHER_FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('is refused while the fleet does not answer, for the next pass to label', async () => {
    fleet.state.isAnswering = false;

    await expect(labelSquadrons(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
