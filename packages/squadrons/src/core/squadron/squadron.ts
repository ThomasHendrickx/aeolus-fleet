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
