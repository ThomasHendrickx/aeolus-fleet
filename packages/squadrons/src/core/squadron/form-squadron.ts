import { SHIP_HANDLE_MAX_LENGTH, SHIP_HANDLE_PATTERN, type ShipId } from '@aeolus-fleet/common';

import type { Catalogue, TemplateReference } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { FormationAttempts, RandomNames, SquadronRepository } from './ports.js';
import type { Member } from './squadron.js';

const SQUADRON_SUFFIX_LENGTH = 6;
const MEMBER_SUFFIX_LENGTH = 4;
/** How many random names a member gets before forming gives up on it. */
const NAME_ATTEMPTS = 5;

export type FormRefusal = DomainError<
  'BLUEPRINT_NOT_FOUND' | 'INVALID_SQUADRON_ID' | 'SQUADRON_ID_TAKEN' | 'MANAGEMENT_SHIP_NOT_CREWED' | 'FORMING_FAILED'
>;

export interface FormedSquadron {
  squadronId: string;
  flagship: { shipId: ShipId; name: string };
  /** Each member with its crew line, launch note and pinned model: shown once, never stored. */
  members: { shipId: ShipId; name: string; role: string; crewLine: string; launchNote: string | null; model: string | null }[];
}

export type FormSquadron = (input: {
  blueprint: TemplateReference;
  squadronId?: string;
}) => Promise<Result<FormedSquadron, FormRefusal>>;

function isHandle(value: string): boolean {
  return value.length <= SHIP_HANDLE_MAX_LENGTH && SHIP_HANDLE_PATTERN.test(value);
}

/** The ship's secret: the crew line is `/aeolus:crew <fleetUrl> <shipId> <secret>`. */
function secretIn(crewLine: string): string {
  return crewLine.trim().split(/\s+/).at(-1) ?? '';
}

/**
 * Use case: the operator forms a squadron from a blueprint version (#86, B2;
 * docs/squadrons.md, "Names"). Through the fleet's API, as its management
 * ship, squadrons commissions the flagship, named as the squadron and of type
 * `flagship`, and crews it at once with its secret; then each role's members,
 * `<role>-<4 random>` (or `<squadron>:<role>-<n>` when the blueprint chooses
 * prefixed names), of type `<squadron>:<role>`. Each member's crew line gets
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
  catalogue: () => Catalogue;
  random: RandomNames;
  clock: Clock;
}): FormSquadron {
  return async (input) => {
    const crew = await deps.management.find();
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons crews no management ship yet');
    }
    const { blueprints, templates } = deps.catalogue();
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

    // One attempt per squadron id at a time: its id and its start tell attempts apart.
    const startedAt = deps.clock.now();
    const attemptId = `${squadronId}@${startedAt.toISOString()}`;
    await deps.attempts.begin({ id: attemptId, fleetId: crew.fleetId, squadronId, startedAt });
    const commissioned: ShipId[] = [];
    const failed = async (refusal: FleetRefusal): Promise<Result<never, FormRefusal>> => {
      for (const shipId of commissioned) {
        await deps.door.retire(crew.crewToken, { shipId });
      }
      await deps.attempts.finish(attemptId);
      return refuse('FORMING_FAILED', `The fleet refused a step, so nothing was formed: ${refusal.message}`);
    };
    // A lost answer is asked again under the same key, so the fleet commissions
    // no second ship; its repeat holds no secret, so the ship gets a new starting prompt.
    const commissionOnce = async (ship: { name: string; type: string; idempotencyKey: string }): Promise<Result<{ shipId: ShipId; crewLine: string }, FleetRefusal>> => {
      let made = await deps.door.commission(crew.crewToken, ship);
      if (!made.isOk && made.error.code === 'UNAVAILABLE') {
        made = await deps.door.commission(crew.crewToken, ship);
      }
      if (!made.isOk) {
        return made;
      }
      const { shipId, crewLine } = made.value;
      commissioned.push(shipId);
      await deps.attempts.commissioned(attemptId, { name: ship.name, shipId });
      if (crewLine !== null) {
        return ok({ shipId, crewLine });
      }
      const prompt = await deps.door.getStartingPrompt(crew.crewToken, { shipId });
      return prompt.isOk ? ok({ shipId, crewLine: prompt.value.crewLine }) : prompt;
    };
    // `slot` is the ship's place in the squadron, so a name drawn twice in one forming never repeats another ship's key.
    const commission = async (slot: string, ship: { names: () => string; type: string }): Promise<Result<{ shipId: ShipId; name: string; crewLine: string }, FleetRefusal>> => {
      let refusal: FleetRefusal = { code: 'CONFLICT', message: 'no free name' };
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
        const shipName = ship.names();
        await deps.attempts.plan(attemptId, shipName);
        const made = await commissionOnce({ name: shipName, type: ship.type, idempotencyKey: `${attemptId}:${slot}:${shipName}` });
        if (made.isOk) {
          return ok({ ...made.value, name: shipName });
        }
        refusal = made.error;
        if (refusal.code !== 'CONFLICT') {
          break;
        }
      }
      return err(refusal);
    };

    const flagship = await commission('flagship', { names: () => squadronId, type: 'flagship' });
    if (!flagship.isOk) {
      return failed(flagship.error);
    }
    const crewed = await deps.door.register({ shipId: flagship.value.shipId, secret: secretIn(flagship.value.crewLine) });
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
        const { shipId, name: memberName, crewLine } = member.value;
        members.push({ shipId, name: memberName, role: role.name, type: `${squadronId}:${role.name}`, onStationAt: null, checkIn: null });
        lines.push({ shipId, name: memberName, role: role.name, crewLine: `${crewLine} ${squadronId}`, launchNote: used[index]?.launchNote ?? null, model: used[index]?.model ?? null });
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
