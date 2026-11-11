import { accountIdSchema, idSchema, type FleetId, type ScopeName, type ShipId, type ShipKind } from '@aeolus-fleet/common';
import { harbourStateOf } from '@aeolus-fleet/common/rules';

import { isGrantedByRuleMatches, ruleMatchesOf, type RuleMatchFilter } from '../../src/domain/registry/rule-matches.js';
import type { PersonShipPageRead, PersonShipReadTx } from '../../src/domain/registry/person-ship-reads.js';
import { crewDescription } from '../../src/domain/registry/crew-description.js';
import type { PersonReadUnitOfWork } from '../../src/domain/registry/person-read-unit-of-work.js';
import type { NetworkRule, ReachingShip } from '../../src/domain/registry/network-settings.js';
import { isCrew, isShipCaller, type AccountCaller, type Caller, type Crew } from '../../src/domain/shared/caller.js';
import type { Result } from '../../src/domain/shared/result.js';

export const PERSON_READ_FLEET = idSchema('fleet').parse('flt_00000000000000000000000001');
export const personReadShipId = (number: number) => idSchema('ship').parse(`shp_${String(number).padStart(26, '0')}`);
export const PERSON_READ_LABEL = idSchema('label').parse('lbl_00000000000000000000000001');
export const PERSON_READ_VALUE = idSchema('labelValue').parse('lbv_00000000000000000000000001');

export interface PersonReadShipFixture {
  id: ShipId;
  fleetId: FleetId;
  name: string;
  kind: ShipKind;
  owner: ShipId | null;
  labels: ReachingShip['labels'];
  scopes: readonly ScopeName[];
  isActive: boolean;
  isCrewed: boolean;
  summary: string | null;
  commissionNote: string | null;
  note: string | null;
  reportState: 'working' | 'blocked' | 'idle' | null;
  hasOpenAlert: boolean;
  lastActivityAt: string | null;
}

export function aPersonReadShip(number: number, change: Partial<PersonReadShipFixture> = {}): PersonReadShipFixture {
  return { id: personReadShipId(number), fleetId: PERSON_READ_FLEET, name: `ship-${String(number).padStart(2, '0')}`, kind: 'agent', owner: personReadShipId(91), labels: [], scopes: ['messages:send', 'fleet:read'], isActive: true, isCrewed: true, summary: null, commissionNote: null, note: null, reportState: null, hasOpenAlert: false, lastActivityAt: null, ...change };
}

export function aPersonReadCrew(number = 90): Crew {
  return { kind: 'person', shipId: personReadShipId(number), fleetId: PERSON_READ_FLEET, leaseId: idSchema('lease').parse(`lse_${String(number).padStart(26, '0')}`), scopes: ['messages:send', 'fleet:read'] };
}

export function aPersonReadAccount(change: Partial<AccountCaller> = {}): AccountCaller {
  return { kind: 'account', accountId: accountIdSchema.parse('account-one'), fleetId: PERSON_READ_FLEET, scopes: ['fleet:read'], groupValues: [], personShipId: personReadShipId(90), throughShipId: null, ...change };
}

/** The in-memory form of the read's decision: the subject's filter against the ship's matches of the fleet's own rules. */
function reachesBy(rules: readonly NetworkRule[]) {
  return (filter: RuleMatchFilter, ship: PersonReadShipFixture): boolean =>
    isGrantedByRuleMatches(filter, { candidate: ship, matches: ruleMatchesOf(ship, [{ source: { kind: 'fleet' }, rules }]) });
}

export class PersonReadMemory {
  ships: PersonReadShipFixture[] = [
    aPersonReadShip(90, { name: 'person', kind: 'person', owner: personReadShipId(90) }),
    aPersonReadShip(91, { name: 'argo', kind: 'operator', owner: null }),
    aPersonReadShip(92, { name: 'viewer', kind: 'viewer', owner: null, isCrewed: false }),
  ];
  rules: readonly NetworkRule[] | null = null;
  hasReportFailure = false;
  forbiddenReportIds = new Set<ShipId>();

  private reaching(ship: PersonReadShipFixture): ReachingShip {
    return { id: ship.id, kind: ship.kind, owner: ship.owner, labels: ship.labels, isOwnedByPerson: this.ships.some((owner) => owner.id === ship.owner && owner.kind === 'person') };
  }

  private active(fleetId: FleetId, id: ShipId | null) {
    return this.ships.find((ship) => ship.fleetId === fleetId && ship.id === id && ship.isActive);
  }

  private reaches(filter: RuleMatchFilter, ship: PersonReadShipFixture): boolean {
    return reachesBy(this.rules ?? [])(filter, ship);
  }

  private isSendable(ship: PersonReadShipFixture, sender: { shipId: ShipId; permission: RuleMatchFilter } | null) {
    return sender !== null && ship.id !== sender.shipId && ship.kind !== 'viewer' && this.reaches(sender.permission, ship);
  }

  private isSelected(ship: PersonReadShipFixture, page: PersonShipPageRead) {
    const policy = page.policy;
    const isAuthorized = policy.section === 'discovery' ? this.isSendable(ship, policy.sender)
      : this.reaches(policy.reader, ship) && !this.isSendable(ship, policy.sender);
    const description = crewDescription(ship.isCrewed && ship.summary !== null ? { summary: ship.summary } : null);
    const query = page.search.toLowerCase();
    const name = ship.name.toLowerCase();
    const after = page.after;
    return isAuthorized && (page.shipIds === undefined || page.shipIds.includes(ship.id))
      && (name.includes(query) || description?.toLowerCase().includes(query) === true)
      && (after === undefined || name > after.name || (name === after.name && ship.id > after.shipId));
  }

  readonly tx: PersonShipReadTx = {
    facts: {
      find: (caller: Caller) => {
        const associatedId = caller.kind === 'account' ? caller.personShipId : isShipCaller(caller) ? caller.shipId : null;
        const stored = this.ships.find((ship) => ship.fleetId === caller.fleetId && ship.id === associatedId);
        const associated = stored?.isActive === true ? stored : undefined;
        const reader = caller.kind === 'account' ? { kind: 'account' as const, personShipId: stored?.id ?? null, labels: [] }
          : caller.kind === 'installation' ? { kind: 'installation' as const } : associated === undefined ? null : this.reaching(associated);
        return Promise.resolve({ reader, scopes: isShipCaller(caller) ? associated?.scopes ?? [] : caller.scopes,
          sender: associated === undefined ? null : { ship: this.reaching(associated), scopes: associated.scopes },
          isCrewActive: isCrew(caller) && associated?.isCrewed === true,
          rules: { isOpen: this.rules === null, isViewerReadOn: true, sources: [{ source: { kind: 'fleet' as const }, rules: this.rules ?? [] }], everyCandidateVerbs: [] } });
      },
    },
    projection: {
      page: (fleetId, page) => Promise.resolve(this.ships.filter((ship) => ship.fleetId === fleetId && ship.isActive && this.isSelected(ship, page))
        .map((ship) => ({ row: { shipId: ship.id, name: ship.name, kind: ship.kind, description: crewDescription(ship.isCrewed && ship.summary !== null ? { summary: ship.summary } : null) }, position: { name: ship.name.toLowerCase(), shipId: ship.id } }))
        .sort((first, second) => first.position.name < second.position.name ? -1 : first.position.name > second.position.name ? 1 : first.position.shipId < second.position.shipId ? -1 : 1)
        .slice(0, page.shipIds === undefined ? 21 : 20)),
      selectedReports: (fleetId, selected) => this.tx.projection.reports(fleetId, { permission: { isEvery: true }, shipIds: selected.map(({ row }) => row.shipId) }),
      reports: (fleetId, read) => {
        if (this.hasReportFailure || read.shipIds.length === 0 || read.shipIds.length > 20 || read.shipIds.some((id) => this.forbiddenReportIds.has(id))) {
          return Promise.reject(new Error('The report projection must receive only concerned loaded ids'));
        }
        return Promise.resolve({ rows: read.shipIds.map((shipId) => {
          const ship = this.active(fleetId, shipId);
          if (ship === undefined || !this.reaches(read.permission, ship)) {
            return { shipId, report: { status: 'unavailable' as const } };
          }
          const isCrewed = ship.kind === 'operator' || ship.kind === 'viewer' || ship.isCrewed;
          return { shipId, report: { status: 'read' as const, state: harbourStateOf({ status: isCrewed ? 'crewed' : 'awaitingCrew', reportState: ship.reportState, hasOpenAlert: ship.hasOpenAlert }), note: ship.isCrewed ? ship.note : null, lastActivityAt: ship.lastActivityAt } };
        }) });
      },
    },
  };

  readonly uow: PersonReadUnitOfWork<PersonShipReadTx> = {
    run: <T, E>(_fleetId: FleetId, work: (tx: PersonShipReadTx) => Promise<Result<T, E>>) => work(this.tx),
  };
}
