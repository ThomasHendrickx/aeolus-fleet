import type { AgentKind, CrewRequestKey, LabelValueId, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

import { carriesEvery } from './label.js';
import { isNeedingCrew } from './ship-counts.js';
import type { ListedShip } from './list-fleet.js';

/** What the fleet snapshot's reads select by status when the caller asks none: the active ships, so retired ones come only when asked. */
export const ACTIVE_STATUSES: readonly ShipStatus[] = ['awaitingCrew', 'crewed'];

/** The statuses asked, or the active ones when none are. */
export function statusesAsked(status: readonly ShipStatus[] | undefined): readonly ShipStatus[] {
  return status === undefined || status.length === 0 ? ACTIVE_STATUSES : status;
}

/**
 * Which ships a page of the fleet snapshot selects (decision 4 of the
 * performance design): the overview's search and filters, applied where the
 * ships are read, so a page holds only matches. Every filter combines with
 * AND; one left out, or empty, selects every ship.
 */
export interface ShipFilter {
  /** Text the ship's name or type holds, in any case. */
  query?: string;
  /** The ship's exact name: whether a ship has it, for a name field's hint. */
  name?: string;
  /** Any of these statuses. */
  status?: readonly ShipStatus[];
  /** Any of these types. */
  type?: readonly string[];
  /** Any of these crew request keys (crewRequestKeyOf). */
  crewRequest?: readonly CrewRequestKey[];
  /** Every one of these label values (decision 0031). */
  valueIds?: readonly LabelValueId[];
  /** Ships whose crew request is assigned to any of these trierarch ships: a machine's spots. */
  assignedTo?: readonly ShipId[];
  /** The ships on Needs crew, with the trierarch plugin connected or without it (isNeedingCrew). */
  needsCrew?: 'withTrierarchs' | 'withoutTrierarchs';
  /** Any of these ships: a squadron's flagship and members, as the console resolves them. */
  shipIds?: readonly ShipId[];
  /** Any of these ship kinds: argo and the person ships, for an owner picker (decision 0045). */
  shipKind?: readonly ShipKind[];
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

/**
 * Whether the filter selects the ship. A ship outside the caller's read reach
 * shows its name, type and status only (decision 0034), so the filters on
 * what it does not show (crew request and its trierarch, agent kind, label values) never
 * select it.
 */
export function matchesShipFilter(ship: ListedShip, { filter, isInReach }: { filter: ShipFilter; isInReach: boolean }): boolean {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const isHiddenFilterPicked = filter.needsCrew !== undefined || [filter.crewRequest, filter.assignedTo, filter.kind, filter.valueIds].some((picked) => picked !== undefined && picked.length > 0);
  return (
    (isInReach || !isHiddenFilterPicked) &&
    (query === '' || ship.name.toLowerCase().includes(query) || ship.type.toLowerCase().includes(query)) &&
    (filter.name === undefined || ship.name === filter.name) &&
    isPicked(filter.status, ship.status) &&
    isPicked(filter.type, ship.type) &&
    isPicked(filter.shipKind, ship.kind) &&
    isPicked(filter.crewRequest, crewRequestKeyOf(ship.crewRequest)) &&
    isAssignedToAny(filter.assignedTo, ship.crewRequest) &&
    (filter.needsCrew === undefined || isNeedingCrew(ship, { hasTrierarchs: filter.needsCrew === 'withTrierarchs' })) &&
    carriesEvery(ship.labels, filter.valueIds) &&
    isPicked(filter.shipIds, ship.id) &&
    isPicked(filter.kind, agentKindOf(ship, filter.pluginShipIds))
  );
}

/** Whether the ship's crew request is assigned to one of the trierarchs picked; nothing picked passes every ship. */
function isAssignedToAny(trierarchShipIds: readonly ShipId[] | undefined, crewRequest: ListedShip['crewRequest']): boolean {
  const assignedTo = crewRequest?.assignedTo?.id;
  return trierarchShipIds === undefined || trierarchShipIds.length === 0 || (assignedTo !== undefined && trierarchShipIds.includes(assignedTo));
}

function isPicked<Value>(picked: readonly Value[] | undefined, value: Value): boolean {
  return picked === undefined || picked.length === 0 || picked.includes(value);
}
