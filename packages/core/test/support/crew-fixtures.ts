import type { FleetId, FleetScope, Scope, ShipId } from '@aeolus-fleet/common';

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
  const fleetScopes = ship.scopes.filter((scope) => scope !== 'messages:send' && scope !== 'messages:receive');
  const { shipId } = unwrap(
    await registry.commissionShip(argo, { idempotencyKey: newKey(), name: ship.name, type: ship.type, fleetScopes: fleetScopes.filter(isFleetScope) }),
  );
  return callerOf({ fleetId: argo.fleetId, shipId }, ['messages:send', 'messages:receive', ...fleetScopes]);
}

function isFleetScope(scope: Scope): scope is FleetScope {
  return scope !== 'messages:send' && scope !== 'messages:receive';
}

function callerOf(ship: { fleetId: FleetId; shipId: ShipId }, scopes: Scope[]): Caller {
  return { ...ship, kind: 'agent', scopes };
}
