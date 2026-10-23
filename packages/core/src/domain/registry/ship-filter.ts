import type { AgentKind, CrewRequestKey, LabelValueId, ShipId, ShipStatus } from '@aeolus-fleet/common';

import { carriesEvery } from './label.js';
import type { ListedShip } from './list-fleet.js';

/**
 * Which ships a page of the fleet snapshot selects (decision 4 of the
 * performance design): the overview's search and filters, applied where the
 * ships are read, so a page holds only matches. Every filter combines with
 * AND; one left out, or empty, selects every ship.
 */
export interface ShipFilter {
  /** Text the ship's name or type holds, in any case. */
  query?: string;
  /** Any of these statuses. */
  status?: readonly ShipStatus[];
  /** Any of these types. */
  type?: readonly string[];
  /** Any of these crew request keys (crewRequestKeyOf). */
  crewRequest?: readonly CrewRequestKey[];
  /** Every one of these label values (decision 0031). */
  valueIds?: readonly LabelValueId[];
  /** Any of these ships: a squadron's flagship and members, as the console resolves them. */
  shipIds?: readonly ShipId[];
  /** Any of these agent kinds (agentKindOf). */
  kind?: readonly AgentKind[];
  /** The ships the console's plugins run as: their agent kind is plugin. */
  pluginShipIds?: readonly ShipId[];
}

/** The type of a machine's trierarch ship (decision 0026). */
const TRIERARCH_TYPE = 'trierarch';

const HARNESS_KINDS: Readonly<Partial<Record<string, AgentKind>>> = { 'claude-code': 'claudeCode', codex: 'codex' };

/**
 * What sort of agent crews a ship (idea #401), read from what the fleet
 * knows: argo and the viewer are the console; a ship a console plugin runs as
 * is a plugin; a ship of type trierarch is a machine's trierarch (decision
 * 0026); any other is what its crewing session's harness says (decision
 * 0018), other while no session crews it.
 */
export function agentKindOf(ship: Pick<ListedShip, 'id' | 'kind' | 'type' | 'harness'>, pluginShipIds: readonly ShipId[] = []): AgentKind {
  if (ship.kind === 'operator' || ship.kind === 'viewer') {
    return 'console';
  }
  if (pluginShipIds.includes(ship.id)) {
    return 'plugin';
  }
  if (ship.type === TRIERARCH_TYPE) {
    return 'trierarch';
  }
  return (ship.harness === null ? undefined : HARNESS_KINDS[ship.harness]) ?? 'other';
}

/**
 * Where a ship's crew request stands, as one key: none; assigned to a
 * trierarch, the status it wrote, crewing before it wrote one; crewed by hand
 * while still unassigned; or else needs crew.
 */
export function crewRequestKeyOf(crewRequest: ListedShip['crewRequest']): CrewRequestKey {
  if (crewRequest === null) {
    return 'none';
  }
  if (crewRequest.assignedTo !== null) {
    return crewRequest.status ?? 'crewing';
  }
  return crewRequest.crewedBy === null ? 'needsCrew' : 'crewedByHand';
}

/** Whether the ship is one the filter selects. */
export function matchesShipFilter(ship: ListedShip, filter: ShipFilter): boolean {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return (
    (query === '' || ship.name.toLowerCase().includes(query) || ship.type.toLowerCase().includes(query)) &&
    isPicked(filter.status, ship.status) &&
    isPicked(filter.type, ship.type) &&
    isPicked(filter.crewRequest, crewRequestKeyOf(ship.crewRequest)) &&
    carriesEvery(ship.labels, filter.valueIds) &&
    isPicked(filter.shipIds, ship.id) &&
    isPicked(filter.kind, agentKindOf(ship, filter.pluginShipIds))
  );
}

function isPicked<Value>(picked: readonly Value[] | undefined, value: Value): boolean {
  return picked === undefined || picked.length === 0 || picked.includes(value);
}
