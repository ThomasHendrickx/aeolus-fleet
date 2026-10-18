import type { FleetId, Scope, ShipId } from '@aeolus-fleet/common';

import type { JsonObject } from '../../src/domain/registry/report-details.js';
import type { Caller } from '../../src/domain/shared/caller.js';
import { newKey } from './keys.js';
import type { registryUseCases } from './core-fixtures.js';
import { unwrap } from './result.js';

/**
 * Ships commissioned by argo with the scopes a test needs: the crew request's
 * writers (decision 0029), the trierarch plugin's with crew:assign and a
 * trierarch's with crew:run, or a ship that defines and assigns labels
 * (decision 0031).
 */
export async function shipWithScopes(
  { registry, argo }: { registry: ReturnType<typeof registryUseCases>; argo: Caller },
  ship: { name: string; type: string; scopes: Scope[] },
): Promise<Caller> {
  const added = ship.scopes.filter((scope) => scope !== 'messages:send' && scope !== 'messages:receive');
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: ship.name, type: ship.type, scopes: added }));
  return callerOf({ fleetId: argo.fleetId, shipId }, ['messages:send', 'messages:receive', ...added]);
}

function callerOf(ship: { fleetId: FleetId; shipId: ShipId }, scopes: Scope[]): Caller {
  return { ...ship, kind: 'agent', scopes };
}

/**
 * Crew settings the fleet takes (decision 0027): a folder workspace and no
 * options, with the change over them. Every crew request a test makes goes
 * through it, as the fleet refuses settings that are not crew settings (#809).
 */
export function aCrewSettings(change: JsonObject = {}): JsonObject {
  return { workspace: { kind: 'folder', name: 'notes' }, options: {}, ...change };
}
