import { ANY_LABEL_VALUE, SAME_LABEL_VALUE, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { InstallationCaller, ShipCaller } from '../shared/caller.js';
import { createDeclareNetworkRules } from './declare-network-rules.js';
import type { NetworkRule } from './network-settings.js';
import { createReadDeclaredNetworkRules } from './read-declared-network-rules.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: ShipCaller;
let readDeclaredNetworkRules: ReturnType<typeof createReadDeclaredNetworkRules>;

/** A ship that defines a label with the key and declares that every ship carrying it reaches every other. */
async function declaring(name: string): Promise<{ ship: ShipCaller; rules: NetworkRule[] }> {
  const ship = await shipWithScopes({ registry: registryUseCases(core), argo }, { name, type: name, scopes: ['labels:define', 'labels:assign'] });
  const { labelId } = unwrap(await registryUseCases(core).defineLabel(ship, { key: name, values: ['one'] }));
  const rules = [{ verb: 'send' as const, from: [{ labelId, value: ANY_LABEL_VALUE }], to: [{ labelId, value: ANY_LABEL_VALUE }] }];
  unwrap(await createDeclareNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids })(ship, { rules }));
  return { ship, rules };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T20:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  readDeclaredNetworkRules = createReadDeclaredNetworkRules({ declaredNetworkRules: core.declaredNetworkRules });
});

describe('reading the declared network rules', () => {
  it('answers none while no ship declared any', async () => {
    await expect(readDeclaredNetworkRules(argo)).resolves.toEqual([]);
  });

  it('answers each declaring ship with its whole list', async () => {
    const squadrons = await declaring('squadrons');
    const trierarch = await declaring('trierarch');

    await expect(readDeclaredNetworkRules(argo)).resolves.toEqual([
      { declarer: { kind: 'ship', shipId: squadrons.ship.shipId }, rules: squadrons.rules },
      { declarer: { kind: 'ship', shipId: trierarch.ship.shipId }, rules: trierarch.rules },
    ]);
  });

  it('answers the installation as the declarer of the rules it declared', async () => {
    const installation: InstallationCaller = { kind: 'installation', fleetId, scopes: ['labels:define'] };
    const { labelId } = unwrap(await registryUseCases(core).defineLabel(installation, { key: 'group', values: ['sales'] }));
    const rules = [{ verb: 'send' as const, from: [{ labelId, value: SAME_LABEL_VALUE }], to: [{ labelId, value: SAME_LABEL_VALUE }] }];
    unwrap(await createDeclareNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids })(installation, { rules }));

    await expect(readDeclaredNetworkRules(argo)).resolves.toEqual([{ declarer: { kind: 'installation' }, rules }]);
  });

  it("answers the caller's fleet only", async () => {
    await declaring('squadrons');
    const other = await hostedFleet(core);

    await expect(readDeclaredNetworkRules(agentCaller({ fleetId: other.fleetId, shipId: other.operatorShipId }))).resolves.toEqual([]);
    expect(fleetId).not.toBe(other.fleetId);
  });
});
