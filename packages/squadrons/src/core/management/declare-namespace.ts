import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OperatorNotices } from '../squadron/ports.js';
import { SQUADRONS_NAMESPACE, SQUADRONS_SCOPES } from '../squadron/scopes.js';
import type { ManagementCrewStore, ScopeDoor } from './ports.js';

/** Whether this pass declared the namespace: false when its own ship holds it already, or another ship does. */
export type DeclareNamespace = (fleetId: FleetId) => Promise<Result<{ isDeclared: boolean }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: squadrons takes up its namespace `squadrons` in a fleet with its
 * scopes (decisions 0017 and 0046), which it enforces itself. Each rescan asks
 * while its own ship does not hold it. While another ship holds it squadrons
 * declares nothing and tells argo, once.
 */
export function createDeclareNamespace(deps: { door: ScopeDoor; management: Pick<ManagementCrewStore, 'find'>; operator: OperatorNotices }): DeclareNamespace {
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'squadrons is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listScopes(crew.crewToken);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer its namespaces: ${listed.error.message}`);
    }
    const held = listed.value.find((each) => each.namespace === SQUADRONS_NAMESPACE);
    if (held?.declaredBy === crew.shipId) {
      return ok({ isDeclared: false });
    }
    if (held) {
      await deps.operator.tell({
        fleetId,
        headline: `squadrons cannot declare its namespace: another ship holds ${SQUADRONS_NAMESPACE}`,
        body:
          `- Management ship: ${crew.name}\n- Held by: ${held.declaredBy ?? 'core'}\n\n` +
          'Until that ship is retired, no ship holds a scope of squadrons, so no ship forms a squadron by message.',
        key: 'namespace-taken',
      });
      return ok({ isDeclared: false });
    }
    const declared = await deps.door.declareScopes(crew.crewToken, { namespace: SQUADRONS_NAMESPACE, scopes: SQUADRONS_SCOPES.map((each) => ({ ...each })) });
    if (!declared.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not take its namespace: ${declared.error.message}`);
    }
    return ok({ isDeclared: true });
  };
}
