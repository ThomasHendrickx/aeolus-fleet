import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

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
  /** The stand-down the flagship sent it, once its squadron stands down; null before. */
  standDownMessageId: MessageId | null;
  /** When it sent its flagship stood-down: its open work finished; null before. */
  stoodDownAt: Date | null;
  /** When squadrons retired its ship; null while it serves. */
  retiredAt: Date | null;
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

/** The template version a member's role runs, as the squadron formed with it. */
export function templateOf(squadron: Squadron, member: Member): TemplateVersion | undefined {
  const role = squadron.blueprint.roles.find((each) => each.name === member.role);
  return squadron.templates.find(
    (each) => each.repository === role?.template.repository && each.name === role.template.name && each.version === role.template.version,
  );
}

/** The model a member's template pins; null when it pins none. */
export function pinnedModel(squadron: Squadron, member: Member): string | null {
  return templateOf(squadron, member)?.model ?? null;
}

/**
 * Whether a member runs another model than its template pins: it checked in
 * stating another, or none. Shown on the member; nothing is refused for it.
 */
export function isModelMismatch(squadron: Squadron, member: Member): boolean {
  const pinned = pinnedModel(squadron, member);
  return pinned !== null && member.checkIn !== null && member.checkIn.model !== pinned;
}
