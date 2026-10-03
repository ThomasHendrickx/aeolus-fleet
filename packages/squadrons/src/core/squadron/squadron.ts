import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { BlueprintVersion, TemplateVersion } from '../catalogue/catalogue.js';

/** Where a squadron is in its life (#79): Forming, Sailing, Standing down, Disbanded. */
export type SquadronState = 'forming' | 'sailing' | 'standing-down' | 'disbanded';

/** A member: an Aeolus ship and its role in the squadron. Crew, report and health are read from the fleet. */
export interface Member {
  shipId: ShipId;
  name: string;
  role: string;
  /** `<squadron id>:<role>`: hand-offs to the role go to any ship of this type. */
  type: string;
  /** When its session confirmed the role at check-in; null until then. */
  onStationAt: Date | null;
  /** Its last check-in: when, and the model it stated (null when it stated none); null before its first. */
  checkIn: { at: Date; model: string | null } | null;
}

/** A squadron, with the blueprint and templates it formed from as they were then. */
export interface Squadron {
  id: string;
  fleetId: FleetId;
  state: SquadronState;
  blueprint: BlueprintVersion;
  templates: TemplateVersion[];
  /** The squadron's own ship, named as the squadron, crewed by squadrons itself. */
  flagship: { shipId: ShipId; name: string; crewToken: string };
  members: Member[];
  formedAt: Date;
  sailedAt: Date | null;
}

/** The model a member's template pins; null when it pins none. */
export function pinnedModel(squadron: Squadron, member: Member): string | null {
  const role = squadron.blueprint.roles.find((each) => each.name === member.role);
  const template = squadron.templates.find(
    (each) => each.repository === role?.template.repository && each.name === role.template.name && each.version === role.template.version,
  );
  return template?.model ?? null;
}

/**
 * Whether a member runs another model than its template pins: it checked in
 * stating another, or none. Shown on the member; nothing is refused for it.
 */
export function isModelMismatch(squadron: Squadron, member: Member): boolean {
  const pinned = pinnedModel(squadron, member);
  return pinned !== null && member.checkIn !== null && member.checkIn.model !== pinned;
}
