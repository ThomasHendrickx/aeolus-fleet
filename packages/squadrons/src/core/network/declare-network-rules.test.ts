import { ANY_LABEL_VALUE, SAME_LABEL_VALUE, type LabelId, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { fakeNetworkFleet, OTHER_OWNER } from '../../../test/support/network-fakes.js';
import { createDeclareNetworkRules } from './declare-network-rules.js';
import type { Declarations } from './ports.js';
import { createWithdrawNetworkRules } from './withdraw-network-rules.js';

const AT = new Date('2026-10-11T12:00:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_squadrons';
const SQUADRON: LabelId = 'lbl_01m3tbfspe96yf1rnr4ank9s00';
const ROLE: LabelId = 'lbl_01m3tbfspe96yf1rnr4ank9r00';
const FLAGSHIP: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9r01';
const SQUADRONS: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9r02';

let fleet: ReturnType<typeof fakeNetworkFleet>;
let declarations: Declarations;
let declare: ReturnType<typeof createDeclareNetworkRules>;
let withdraw: ReturnType<typeof createWithdrawNetworkRules>;

function theSquadronLabel(owner: ShipId = SHIP_ID): void {
  fleet.state.labels.push({ labelId: SQUADRON, key: 'squadron', values: [{ valueId: 'lbv_01m3tbfspe96yf1rnr4ank9s01', value: 'team-1' }], ownerShipId: owner });
}

function theRoleLabel(owner: ShipId = SHIP_ID): void {
  fleet.state.labels.push({
    labelId: ROLE,
    key: 'squadron-role',
    values: [
      { valueId: FLAGSHIP, value: 'flagship' },
      { valueId: SQUADRONS, value: 'squadrons' },
    ],
    ownerShipId: owner,
  });
}

const WITHIN_A_SQUADRON = { from: [{ labelId: SQUADRON, value: SAME_LABEL_VALUE }], to: [{ labelId: SQUADRON, value: SAME_LABEL_VALUE }] };
const FLAGSHIP_TO_SQUADRONS = { from: [FLAGSHIP], to: [SQUADRONS] };
const SQUADRONS_TO_FLAGSHIP = { from: [SQUADRONS], to: [FLAGSHIP] };

beforeEach(async () => {
  fleet = fakeNetworkFleet(new Set([CREW_TOKEN]));
  const management = memoryManagementStore();
  await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: CREW_TOKEN, crewedAt: AT });
  declarations = new Map();
  declare = createDeclareNetworkRules({ door: fleet.door, management, declarations });
  withdraw = createWithdrawNetworkRules({ door: fleet.door, management, declarations });
});

describe('squadrons declaring the network rules its squadrons need (#573)', () => {
  it('declares squadron=# to squadron=#, and each flagship to and from its own ship', async () => {
    theSquadronLabel();
    theRoleLabel();

    await expect(declare(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: true } });

    expect(fleet.state.declarations).toEqual([[WITHIN_A_SQUADRON, FLAGSHIP_TO_SQUADRONS, SQUADRONS_TO_FLAGSHIP]]);
  });

  it('never declares any value of its labels, so no flagship reaches another', async () => {
    theSquadronLabel();
    theRoleLabel();

    await declare(FLEET_ID);

    const terms = fleet.state.declarations.flat().flatMap((rule) => [...rule.from, ...rule.to]);
    expect(terms.some((term) => typeof term !== 'string' && term.value === ANY_LABEL_VALUE)).toBe(false);
    expect(terms.some((term) => typeof term !== 'string' && term.labelId === ROLE)).toBe(false);
  });

  it('declares once in this process while its labels stay the same', async () => {
    theSquadronLabel();
    theRoleLabel();
    await declare(FLEET_ID);

    await expect(declare(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: false } });
    expect(fleet.state.declarations).toHaveLength(1);
  });

  it('declares only the flagship rules while the fleet has no squadron label, and all three once it has', async () => {
    theRoleLabel();

    await declare(FLEET_ID);
    theSquadronLabel();
    await declare(FLEET_ID);

    expect(fleet.state.declarations).toEqual([
      [FLAGSHIP_TO_SQUADRONS, SQUADRONS_TO_FLAGSHIP],
      [WITHIN_A_SQUADRON, FLAGSHIP_TO_SQUADRONS, SQUADRONS_TO_FLAGSHIP],
    ]);
  });

  it('declares again after it withdrew them', async () => {
    theSquadronLabel();
    theRoleLabel();
    await declare(FLEET_ID);
    await withdraw(FLEET_ID);

    await expect(declare(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: true } });
    expect(fleet.state.declarations).toHaveLength(3);
  });

  it('declares no rule on a key another ship owns', async () => {
    theSquadronLabel(OTHER_OWNER);
    theRoleLabel();

    await declare(FLEET_ID);

    expect(fleet.state.declarations).toEqual([[FLAGSHIP_TO_SQUADRONS, SQUADRONS_TO_FLAGSHIP]]);
  });

  it('declares nothing while it owns neither label', async () => {
    await expect(declare(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: false } });

    expect(fleet.state.declarations).toEqual([]);
  });

  it('is refused for a fleet it is not connected to', async () => {
    await expect(declare(OTHER_FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('is refused while the fleet does not answer, and declares on the next pass', async () => {
    theSquadronLabel();
    theRoleLabel();
    fleet.state.isAnswering = false;

    await expect(declare(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    fleet.state.isAnswering = true;
    await expect(declare(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: true } });
  });
});
