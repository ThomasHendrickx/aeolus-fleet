import { SAME_LABEL_VALUE, type FleetId, type NetworkRule } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../management/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SQUADRON_LABEL, SQUADRON_ROLE_LABEL } from './label-squadrons.js';
import type { Declarations, ListedLabel, NetworkDoor } from './ports.js';

/** Whether this pass declared to the fleet: false when it holds its declaration already or has nothing to declare yet. */
export type DeclareNetworkRules = (fleetId: FleetId) => Promise<Result<{ isDeclared: boolean }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: squadrons declares the network rules its squadrons need (#573,
 * decision 0037), on the labels it owns: every ship reaches the ships of its
 * own squadron, `squadron=#` to `squadron=#`, and the flagships reach its own
 * ship and back, `squadron-role=flagship` to `squadron-role=squadrons` and the
 * reverse. Exact values only on squadron-role, so no flagship reaches another.
 * A rule whose label the fleet does not have yet, or another ship owns, is
 * left out until the label pass defines it. Declared once per ship and rules
 * in this process; a fleet that did not answer is declared on the next pass.
 */
export function createDeclareNetworkRules(deps: { door: NetworkDoor; management: Pick<ManagementCrewStore, 'find'>; declarations: Declarations }): DeclareNetworkRules {
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'squadrons is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listLabels(crew.crewToken);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer its network rules: ${listed.error.message}`);
    }
    const owned = (key: string): ListedLabel | undefined => listed.value.find((each) => each.key === key && each.ownerShipId === crew.shipId);
    const rules = rulesOn({ squadron: owned(SQUADRON_LABEL), role: owned(SQUADRON_ROLE_LABEL.key) });
    const declaration = JSON.stringify(rules);
    if (rules.length === 0 || deps.declarations.get(crew.shipId) === declaration) {
      return ok({ isDeclared: false });
    }
    const declared = await deps.door.declareNetworkRules(crew.crewToken, { rules });
    if (!declared.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not take its network rules: ${declared.error.message}`);
    }
    deps.declarations.set(crew.shipId, declaration);
    return ok({ isDeclared: true });
  };
}

/** The rules on the labels squadrons owns: within a squadron on its squadron label, and between flagships and its own ship on squadron-role. */
function rulesOn(labels: { squadron: ListedLabel | undefined; role: ListedLabel | undefined }): NetworkRule[] {
  const rules: NetworkRule[] = [];
  if (labels.squadron !== undefined) {
    const same = { labelId: labels.squadron.labelId, value: SAME_LABEL_VALUE };
    rules.push({ from: [same], to: [same] });
  }
  const valueOf = (value: string) => labels.role?.values.find((each) => each.value === value)?.valueId;
  const flagship = valueOf(SQUADRON_ROLE_LABEL.flagship);
  const squadrons = valueOf(SQUADRON_ROLE_LABEL.squadrons);
  if (flagship !== undefined && squadrons !== undefined) {
    rules.push({ from: [flagship], to: [squadrons] }, { from: [squadrons], to: [flagship] });
  }
  return rules;
}
