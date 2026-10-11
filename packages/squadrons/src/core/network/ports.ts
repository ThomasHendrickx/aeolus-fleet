import type { LabelId, LabelValueId, NetworkRule, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../management/ports.js';
import type { Result } from '../shared/result.js';

/** A label of the fleet as `fleet.labels` lists it: its key, its values and the ship that owns it. */
export interface ListedLabel {
  labelId: LabelId;
  key: string;
  values: { valueId: LabelValueId; value: string }[];
  ownerShipId: ShipId;
}

/** A ship of the fleet that is not retired, with the label values it carries. */
export interface LabelledShip {
  shipId: ShipId;
  labels: { labelId: LabelId; valueId: LabelValueId }[];
}

/**
 * Outbound port: the fleet's label and network rule calls, as squadrons makes
 * them for its management ship (decisions 0031, 0037).
 */
export interface NetworkDoor {
  /** Every label of the fleet, with its owner (fleet:read). */
  listLabels(crewToken: string): Promise<Result<ListedLabel[], FleetRefusal>>;
  /** Defines a label the crew token's ship owns (labels:define); a key the fleet has already is CONFLICT. */
  defineLabel(crewToken: string, label: { key: string; values: string[] }): Promise<Result<{ labelId: LabelId; values: { valueId: LabelValueId; value: string }[] }, FleetRefusal>>;
  /** Gives one of its own labels its whole set of values (labels:define): a kept value keeps its id; removing one a ship carries is refused. */
  changeLabelValues(crewToken: string, change: { labelId: LabelId; values: string[] }): Promise<Result<{ values: { valueId: LabelValueId; value: string }[] }, FleetRefusal>>;
  /** The fleet's ships that are not retired, with the values they carry (fleet:read). */
  listLabelledShips(crewToken: string): Promise<Result<LabelledShip[], FleetRefusal>>;
  /** Puts one of its own label values on a ship (labels:assign). */
  assignLabel(crewToken: string, assignment: { shipId: ShipId; valueId: LabelValueId }): Promise<Result<undefined, FleetRefusal>>;
  /** Takes one of its own label values off a ship (labels:assign). */
  unassignLabel(crewToken: string, assignment: { shipId: ShipId; valueId: LabelValueId }): Promise<Result<undefined, FleetRefusal>>;
  /** Declares the network rules its ship needs on the labels it owns, its whole list; an empty one withdraws them (labels:define). */
  declareNetworkRules(crewToken: string, declaration: { rules: NetworkRule[] }): Promise<Result<{ rules: number }, FleetRefusal>>;
}

/**
 * What this process declared, per management ship: the rules' labels as one
 * text, or null once it withdrew them. Every declaration writes an event the
 * networking plugin supplies the fleet again on, so squadrons declares only
 * what it did not declare already.
 */
export type Declarations = Map<ShipId, string | null>;
