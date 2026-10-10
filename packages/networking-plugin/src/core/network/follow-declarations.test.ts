import type { LabelValueId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { suppliedFleet } from '../../../test/support/supplied-fleet.js';
import { createFollowDeclarations } from './follow-declarations.js';

const SQUADRONS: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9003';
const ALPHA: LabelValueId = 'lbv_01m3tbfspe96yf1rnr4ank9001';
const DECLARED = [{ from: [ALPHA], to: [ALPHA] }];

let parts: Awaited<ReturnType<typeof suppliedFleet>>;
let followDeclarations: ReturnType<typeof createFollowDeclarations>;

beforeEach(async () => {
  parts = await suppliedFleet();
  await parts.networks.save(FLEET_ID, { rules: [], declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 } });
  followDeclarations = createFollowDeclarations({ door: parts.fleet.door, connections: parts.connections, supplies: parts.supplies });
});

describe("following a fleet's declared rules (decision 0037)", () => {
  it('starts where the fleet is now and supplies it once, so a rule declared before is in the list', async () => {
    parts.fleet.state.events.push('NetworkRulesDeclared');
    parts.fleet.state.declared.push({ shipId: SQUADRONS, rules: DECLARED });

    await expect(followDeclarations(FLEET_ID)).resolves.toEqual({ isOk: true, value: { supplied: true } });
    expect(parts.fleet.state.followedFrom).toEqual([undefined]);
    expect(parts.fleet.state.rules).toEqual(DECLARED);
  });

  it('supplies the fleet again when a ship declares or withdraws its rules', async () => {
    await followDeclarations(FLEET_ID);
    parts.fleet.state.events.push('LabelAssigned', 'NetworkRulesDeclared');
    parts.fleet.state.declared.push({ shipId: SQUADRONS, rules: DECLARED });

    await expect(followDeclarations(FLEET_ID)).resolves.toEqual({ isOk: true, value: { supplied: true } });
    expect(parts.fleet.state.followedFrom).toEqual([undefined, 0]);
    expect(parts.fleet.state.rules).toEqual(DECLARED);
  });

  it('follows on from where it got to, supplying nothing for other events', async () => {
    await followDeclarations(FLEET_ID);
    parts.fleet.state.events.push('LabelAssigned');
    await followDeclarations(FLEET_ID);
    const version = parts.fleet.state.version;
    parts.fleet.state.events.push('MessageAccepted');

    await expect(followDeclarations(FLEET_ID)).resolves.toEqual({ isOk: true, value: { supplied: false } });
    expect(parts.fleet.state.followedFrom).toEqual([undefined, 0, 1]);
    expect(parts.fleet.state.version).toBe(version);
  });

  it('is refused while the fleet does not answer, following on from where it got to next time', async () => {
    await followDeclarations(FLEET_ID);
    parts.fleet.state.isAnswering = false;

    await expect(followDeclarations(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    parts.fleet.state.isAnswering = true;
    await followDeclarations(FLEET_ID);
    expect(parts.fleet.state.followedFrom).toEqual([undefined, 0]);
  });

  it('drops a crew token the fleet no longer takes: not connected', async () => {
    parts.fleet.state.liveTokens.clear();

    await expect(followDeclarations(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    await expect(parts.connections.find(FLEET_ID)).resolves.toBeUndefined();
  });
});
