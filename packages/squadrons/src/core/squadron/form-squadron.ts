import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN, type CrewLine, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { Catalogue, TemplateReference } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FormationAttempts, RandomNames, SquadronRepository } from './ports.js';
import { withSquadronId } from './crew-lines.js';
import { beginFormation } from './formation.js';
import type { Member } from './squadron.js';

const SQUADRON_SUFFIX_LENGTH = 6;
const MEMBER_SUFFIX_LENGTH = 4;

export type FormRefusal = DomainError<
  'BLUEPRINT_NOT_FOUND' | 'INVALID_SQUADRON_ID' | 'SQUADRON_ID_TAKEN' | 'MANAGEMENT_SHIP_NOT_CREWED' | 'FORMING_FAILED'
>;

export interface FormedSquadron {
  squadronId: string;
  flagship: { shipId: ShipId; name: string };
  /** Each member with its crew lines, launch note and pinned model: shown once, never stored. */
  members: { shipId: ShipId; name: string; role: string; crewLines: CrewLine[]; launchNote: string | null; model: string | null }[];
}

export type FormSquadron = (input: {
  /** The fleet it forms in: the operator's. */
  fleetId: FleetId;
  blueprint: TemplateReference;
  squadronId?: string;
}) => Promise<Result<FormedSquadron, FormRefusal>>;

function isHandle(value: string): boolean {
  return value.length <= SHIP_HANDLE_MAX_LENGTH && SHIP_HANDLE_PATTERN.test(value);
}

/**
 * Use case: the operator forms a squadron from a blueprint version (#86, B2;
 * docs/squadrons.md, "Names"). Through the fleet's API, as its management
 * ship, squadrons commissions the flagship, named as the squadron and of type
 * `flagship`, and crews it at once with its secret; then each role's members,
 * `<role>-<4 random>` (or `<squadron>:<role>-<n>` when the blueprint chooses
 * prefixed names), of type `<squadron>:<role>`. Each member's crew lines get
 * the squadron id and goes back once with its template's launch note;
 * squadrons keeps no member secret. The squadron is stored Forming, with the
 * blueprint and templates as they were. A step the fleet refuses retires every
 * ship this attempt commissioned and forms nothing. Because forming calls the
 * fleet several times, it is no single transaction: the attempt, and each ship
 * by name before it is commissioned, are recorded first, so that a start after
 * a crash retires what an unfinished attempt commissioned (recover-formations).
 * The squadron is stored and its attempt finished together.
 */
export function createFormSquadron(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  squadrons: SquadronRepository;
  attempts: FormationAttempts;
  /** The catalogue of a fleet. */
  catalogue: (fleetId: FleetId) => Catalogue;
  random: RandomNames;
  clock: Clock;
}): FormSquadron {
  return async (input) => {
    const crew = await deps.management.find(input.fleetId);
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const { blueprints, templates } = deps.catalogue(input.fleetId);
    const { repository, name, version } = input.blueprint;
    const blueprint = blueprints.find((held) => held.repository === repository && held.name === name && held.version === version);
    if (!blueprint) {
      return refuse('BLUEPRINT_NOT_FOUND', `The catalogue holds no blueprint ${name}@${String(version)} of ${repository}`);
    }
    const squadronId = input.squadronId ?? `${blueprint.name}-${deps.random.suffix(SQUADRON_SUFFIX_LENGTH)}`;
    if (!isHandle(squadronId)) {
      return refuse('INVALID_SQUADRON_ID', 'A squadron id is a ship handle: lowercase letters, digits, hyphens or colons, at most 48');
    }
    if (await deps.squadrons.exists(crew.fleetId, squadronId)) {
      return refuse('SQUADRON_ID_TAKEN', `A squadron is already named ${squadronId}`);
    }
    const used = blueprint.roles.map((role) =>
      templates.find((held) => held.repository === role.template.repository && held.name === role.template.name && held.version === role.template.version),
    );

    const { attemptId, commission, retireCommissioned } = await beginFormation(deps, { crew, squadronId });
    const failed = async (refusal: FleetRefusal): Promise<Result<never, FormRefusal>> => {
      await retireCommissioned();
      return refuse('FORMING_FAILED', `The fleet refused a step, so nothing was formed: ${refusal.message}`);
    };

    const flagship = await commission('flagship', { names: () => squadronId, type: 'flagship' });
    if (!flagship.isOk) {
      return failed(flagship.error);
    }
    const crewed = await deps.door.register({ shipId: flagship.value.shipId, secret: flagship.value.secret });
    if (!crewed.isOk) {
      return failed(crewed.error);
    }

    const members: Member[] = [];
    const lines: FormedSquadron['members'] = [];
    for (const [index, role] of blueprint.roles.entries()) {
      for (let number = 1; number <= role.count; number += 1) {
        const names =
          blueprint.memberNames === 'prefixed'
            ? () => `${squadronId}:${role.name}-${String(number)}`
            : () => `${role.name}-${deps.random.suffix(MEMBER_SUFFIX_LENGTH)}`;
        const member = await commission(`${role.name}-${String(number)}`, { names, type: `${squadronId}:${role.name}` });
        if (!member.isOk) {
          return failed(member.error);
        }
        const { shipId, name: memberName, crewLines } = member.value;
        members.push({ shipId, name: memberName, role: role.name, type: `${squadronId}:${role.name}`, onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null });
        lines.push({ shipId, name: memberName, role: role.name, crewLines: withSquadronId(crewLines, squadronId), launchNote: used[index]?.launchNote ?? null, model: used[index]?.model ?? null });
      }
    }

    await deps.squadrons.create({
      id: squadronId,
      fleetId: crew.fleetId,
      state: 'forming',
      blueprint,
      // One copy of each template, even when several roles use it.
      templates: [...new Set(used.filter((template) => template !== undefined))],
      flagship: { shipId: flagship.value.shipId, name: squadronId, crewToken: crewed.value.crewToken },
      members,
      formedAt: deps.clock.now(),
      sailedAt: null,
    }, attemptId);
    return ok({ squadronId, flagship: { shipId: flagship.value.shipId, name: squadronId }, members: lines });
  };
}
