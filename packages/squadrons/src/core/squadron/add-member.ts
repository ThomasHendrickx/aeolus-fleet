import type { CrewLine, FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { memberCrewLines } from './crew-lines.js';
import { beginFormation } from './formation.js';
import { crewSettingsOf, formedCrewOf, resolveMachineLabels, type MemberForm } from './member-crew-request.js';
import type { FormationAttempts, RandomNames, SquadronRepository } from './ports.js';

const MEMBER_SUFFIX_LENGTH = 4;

export type AddRefusal = DomainError<'MANAGEMENT_SHIP_NOT_CREWED' | 'SQUADRON_NOT_FOUND' | 'NOT_SAILING' | 'ROLE_NOT_FOUND' | 'ADDING_FAILED'>;

/** The new member with its crew lines, launch note and pinned model: shown once, never stored. */
export interface AddedMember {
  shipId: ShipId;
  name: string;
  role: string;
  crewLines: CrewLine[];
  launchNote: string | null;
  model: string | null;
}

export type AddMember = (input: {
  fleetId: FleetId;
  squadronId: string;
  role: string;
  /** The form's crew settings and parameter values for the member (#343). */
  member?: MemberForm;
}) => Promise<Result<AddedMember, AddRefusal>>;

/**
 * Use case: the operator adds a member of a role to a sailing squadron (#86,
 * B4). It is commissioned with forming's machinery as it is, from the
 * squadron's own snapshot of the role's template, named as forming names a
 * member of that role, and its crew lines (with the squadron id), launch note
 * and pinned model are answered once. Its crew settings, merged from the
 * snapshot and the form, give it a crew request when they name a workspace,
 * as at forming. It checks in like any member; the
 * squadron stays Sailing. The member is stored and its attempt finished in
 * one unit of work, so a crash before that retires the ship at the next
 * start and a crash after it keeps the member.
 */
export function createAddMember(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  squadrons: SquadronRepository;
  attempts: FormationAttempts;
  random: RandomNames;
  clock: Clock;
  /** The fleet's MCP URL, which a member's chat crew line names. */
  mcpUrl: string;
}): AddMember {
  return async ({ fleetId, squadronId, role: roleName, member: form }) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
    if (!squadron) {
      return refuse('SQUADRON_NOT_FOUND', `The fleet has no squadron ${squadronId}`);
    }
    if (squadron.state !== 'sailing') {
      return refuse('NOT_SAILING', `The squadron ${squadronId} is ${squadron.state}: members are added only while it sails`);
    }
    const role = squadron.blueprint.roles.find((each) => each.name === roleName);
    if (!role) {
      return refuse('ROLE_NOT_FOUND', `The squadron ${squadronId} has no role ${roleName}`);
    }
    const template = squadron.templates.find(
      (each) => each.repository === role.template.repository && each.name === role.template.name && each.version === role.template.version,
    );
    const number = squadron.members.filter((member) => member.role === role.name).length + 1;
    const names =
      squadron.blueprint.memberNames === 'prefixed'
        ? () => `${squadronId}:${role.name}-${String(number)}`
        : () => `${role.name}-${deps.random.suffix(MEMBER_SUFFIX_LENGTH)}`;
    const type = `${squadronId}:${role.name}`;
    const memberCrew = template && formedCrewOf({ template, role, form });
    const labels = await resolveMachineLabels(deps.door, { crewToken: crew.crewToken, crews: memberCrew ? [memberCrew] : [] });
    if (!labels.isOk) {
      return refuse(
        'ADDING_FAILED',
        labels.error.kind === 'unknown-label'
          ? `The fleet has no machine label ${labels.error.label}, so no member was added`
          : `The fleet refused a step, so no member was added: ${labels.error.refusal.message}`,
      );
    }

    const formation = await beginFormation(deps, { crew, squadronId });
    const made = await formation.commission(`${role.name}-${String(number)}`, { names, type });
    if (!made.isOk) {
      await formation.retireCommissioned();
      return refuse('ADDING_FAILED', `The fleet refused a step, so no member was added: ${made.error.message}`);
    }
    const { shipId, name } = made.value;
    const settings = memberCrew && crewSettingsOf(memberCrew, { squadronId, labels: labels.value });
    if (settings) {
      const requested = await deps.door.requestCrew(crew.crewToken, { shipId, settings });
      if (!requested.isOk) {
        await formation.retireCommissioned();
        return refuse('ADDING_FAILED', `The fleet refused a step, so no member was added: ${requested.error.message}`);
      }
    }
    await deps.squadrons.update({
      before: squadron,
      after: {
        ...squadron,
        members: [...squadron.members, { shipId, name, role: role.name, type, onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null }],
      },
      finishesAttempt: formation.attemptId,
    });
    return ok({ shipId, name, role: role.name, crewLines: memberCrewLines(made.value, { shipId, role: role.name, squadronId, mcpUrl: deps.mcpUrl }), launchNote: template?.launchNote ?? null, model: template?.model ?? null });
  };
}
