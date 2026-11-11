/** Bounded read ports: actor facts and database-selected ship projections in one snapshot. */
import type { FleetId, PersonShipCursorRecord, PersonShipRow, ScopeName, ShipId, ShipReportsOutput } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import type { ReachingActor, ReachingShip } from './network-settings.js';
import type { RuleMatchFilter, SubjectRuleSources } from './rule-matches.js';

export type PersonShipReadRefusal = DomainError<'INVALID_CURSOR' | 'SCOPE_NOT_HELD' | 'LEASE_ENDED'>;

export interface PersonShipReadFacts {
  reader: ReachingActor | null;
  scopes: readonly ScopeName[];
  sender: { ship: ReachingShip; scopes: readonly ScopeName[] } | null;
  isCrewActive: boolean;
  /** The fleet's own rules, the installation's and the declarations of the subjects' label owners, never every declaration. */
  rules: SubjectRuleSources;
}

export interface DirectSendPermission {
  shipId: ShipId;
  permission: RuleMatchFilter;
}

export type PersonShipPagePolicy =
  | { section: 'discovery'; sender: DirectSendPermission }
  | { section: 'readableContext'; reader: RuleMatchFilter; sender: DirectSendPermission | null };

export interface PersonShipPageRead {
  policy: PersonShipPagePolicy;
  search: string;
  after?: PersonShipCursorRecord['after'];
  shipIds?: readonly ShipId[];
}

export interface PersonShipPageRow {
  row: PersonShipRow;
  position: PersonShipCursorRecord['after'];
}

export interface PersonShipReadTx {
  facts: {
    /** Only the verified actor, its association and the fleet's rules. No recipients. */
    find(caller: Caller, read?: { verbs: readonly ('read' | 'send')[] }): Promise<PersonShipReadFacts>;
  };
  projection: {
    /** At most 21 authorized rows, or at most 20 concerned ids, in database order. */
    page(fleetId: FleetId, read: PersonShipPageRead): Promise<readonly PersonShipPageRow[]>;
    /** Only rows selected by this snapshot, sliced to 20 by the use case. No request ids. */
    selectedReports(fleetId: FleetId, selected: readonly PersonShipPageRow[]): Promise<ShipReportsOutput>;
    reports(fleetId: FleetId, read: { permission: RuleMatchFilter; shipIds: readonly ShipId[] }): Promise<ShipReportsOutput>;
  };
}

/** The association named by verified authentication, independent of current eligibility. */
export function associatedShipIdOf(caller: Caller): ShipId | null {
  return caller.kind === 'account' ? caller.personShipId : caller.kind === 'installation' ? null : caller.shipId;
}
