import type { CrewLine, FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, ManagementCrewStore } from '../management/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SquadronRepository } from './ports.js';
import { memberCrewLines } from './crew-lines.js';
import { templateOf } from './squadron.js';

export type NewCrewLineRefusal = DomainError<'MANAGEMENT_SHIP_NOT_CREWED' | 'SQUADRON_NOT_FOUND' | 'MEMBER_NOT_FOUND' | 'MEMBER_RETIRED' | 'FLEET_UNAVAILABLE'>;

/** A member's new crew lines, with the squadron id, its launch note and pinned model: shown once, never stored. */
export interface NewCrewLineAnswer {
  crewLines: CrewLine[];
  launchNote: string | null;
  model: string | null;
}

export type NewCrewLine = (input: { fleetId: FleetId; squadronId: string; shipId: ShipId }) => Promise<Result<NewCrewLineAnswer, NewCrewLineRefusal>>;

/**
 * Use case: the operator gives a member a new session while keeping its
 * check-in (#86, B4). squadrons releases the member's ship if a session crews
 * it, gets it a new starting prompt, and answers its crew lines with the
 * squadron id appended, so the new crew checks in at its flagship. A recrew
 * from the console gives no squadron id.
 */
export function createNewCrewLine(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  squadrons: SquadronRepository;
  /** The fleet's MCP URL, which a member's chat crew line names. */
  mcpUrl: string;
}): NewCrewLine {
  return async ({ fleetId, squadronId, shipId }) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
    if (!squadron) {
      return refuse('SQUADRON_NOT_FOUND', `The fleet has no squadron ${squadronId}`);
    }
    const member = squadron.members.find((each) => each.shipId === shipId);
    if (!member) {
      return refuse('MEMBER_NOT_FOUND', `The squadron ${squadronId} has no member ${shipId}`);
    }
    if (member.retiredAt !== null) {
      return refuse('MEMBER_RETIRED', `${member.name} is retired: it gets no new crew`);
    }
    const ship = await deps.door.getShip(crew.crewToken, { shipId });
    if (!ship.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not show ${member.name}: ${ship.error.message}`);
    }
    if (ship.value.status === 'crewed') {
      const released = await deps.door.release(crew.crewToken, { shipId });
      if (!released.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not release ${member.name}: ${released.error.message}`);
      }
    }
    const prompt = await deps.door.getStartingPrompt(crew.crewToken, { shipId });
    if (!prompt.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet gave ${member.name} no starting prompt: ${prompt.error.message}`);
    }
    const template = templateOf(squadron, member);
    return ok({ crewLines: memberCrewLines(prompt.value, { shipId, role: member.role, squadronId, mcpUrl: deps.mcpUrl }), launchNote: template?.launchNote ?? null, model: template?.model ?? null });
  };
}
