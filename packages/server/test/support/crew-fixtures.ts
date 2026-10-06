import type { FleetId, Scope, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../../src/core/shared/caller.js';
import { newKey } from './keys.js';
import type { registryUseCases } from './core-fixtures.js';
import { unwrap } from './result.js';

/**
 * Ships of the crew request's three writers (decision 0029), commissioned by
 * argo with their scopes: the trierarch plugin's with crew:assign, and a
 * trierarch's with crew:run.
 */
export async function shipWithScopes(
  registry: ReturnType<typeof registryUseCases>,
  argo: Caller,
  ship: { name: string; type: string; scopes: Scope[] },
): Promise<Caller> {
  const fleetScopes = ship.scopes.filter((scope) => scope !== 'messages:send' && scope !== 'messages:receive');
  const { shipId } = unwrap(
    await registry.commissionShip(argo, { idempotencyKey: newKey(), name: ship.name, type: ship.type, fleetScopes: fleetScopes.filter(isFleetScope) }),
  );
  return callerOf({ fleetId: argo.fleetId, shipId }, ['messages:send', 'messages:receive', ...fleetScopes]);
}

function isFleetScope(scope: Scope): scope is 'fleet:read' | 'fleet:manage' | 'fleet:crew' | 'crew:assign' | 'crew:run' {
  return scope !== 'messages:send' && scope !== 'messages:receive';
}

function callerOf(ship: { fleetId: FleetId; shipId: ShipId }, scopes: Scope[]): Caller {
  return { ...ship, kind: 'agent', scopes };
}
