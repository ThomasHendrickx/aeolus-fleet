/**
 * The fleet's scope calls over its REST API (`/api/v1`), as squadrons makes
 * them for its management ship (decision 0046). A refusal reads as the
 * fleet's code and message; a busy fleet is asked again, as the fleet door does.
 */
import { declareScopesOutputSchema, scopesOutputSchema } from '@aeolus-fleet/common';

import type { ScopeDoor } from '../../core/management/ports.js';
import { ok } from '../../core/shared/result.js';
import { call, type DoorOptions, restDoor } from './rest-fleet-door.js';

export function createRestScopeDoor(fleetUrl: string, options: DoorOptions = {}): ScopeDoor {
  const door = restDoor(fleetUrl, options);
  return {
    listScopes: async (crewToken) => {
      const listed = await call(door, { path: '/fleet/scopes', method: 'GET', crewToken, answers: scopesOutputSchema });
      return listed.isOk ? ok(listed.value.map(({ namespace, declaredBy }) => ({ namespace, declaredBy: declaredBy?.id ?? null }))) : listed;
    },
    declareScopes: async (crewToken, declaration) => {
      const declared = await call(door, { path: '/fleet/declareScopes', method: 'POST', crewToken, body: declaration, answers: declareScopesOutputSchema });
      return declared.isOk ? ok(undefined) : declared;
    },
  };
}
