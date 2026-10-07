import { idSchema, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';

import { labelContextOf, type LabelContext } from '../../lib/labels';

/**
 * Labels for stories (canvas Labels): argo's project, area and cost, the
 * trierarch plugin's os and squadrons' blueprint, and a way to put them on
 * a story's ships.
 */

const ownerId = (suffix: string) => idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4ank${suffix}`);
const labelId = (suffix: string) => idSchema('label').parse(`lbl_01m3tbfspe96yf1rnr4ank${suffix}`);
const valueId = (suffix: string) => idSchema('labelValue').parse(`lbv_01m3tbfspe96yf1rnr4ank${suffix}`);

/** The owners: argo's id is the one the fleet table stories give argo. */
export const OWNERS = {
  argo: { id: ownerId('h1aa'), name: 'argo' },
  trierarchPlugin: { id: ownerId('k0tp'), name: 'trierarch-plugin' },
  squadrons: { id: ownerId('k0sq'), name: 'squadrons' },
} as const;

function aLabel(key: string, definition: { suffix: string; values: string[]; owner: { id: ListedLabel['owner']['id']; name: string } }): ListedLabel {
  return {
    id: labelId(`${definition.suffix}00`),
    key,
    values: definition.values.map((value, index) => ({ id: valueId(`${definition.suffix}${String(index).padStart(2, '0')}`), value })),
    owner: definition.owner,
  };
}

export const PROJECT = aLabel('project', { suffix: 'pr', values: ['aeolus', 'hemma', 'website', 'personal'], owner: OWNERS.argo });
export const AREA = aLabel('area', { suffix: 'ar', values: ['backend', 'infra', 'review', 'docs', 'frontend'], owner: OWNERS.argo });
export const COST = aLabel('cost', { suffix: 'cs', values: ['low', 'high'], owner: OWNERS.argo });
export const OS = aLabel('os', { suffix: 'x5', values: ['macos', 'linux'], owner: OWNERS.trierarchPlugin });
export const BLUEPRINT = aLabel('blueprint', { suffix: 'bp', values: ['hemma-feature', 'aeolus-review'], owner: OWNERS.squadrons });
export const LABELS: ListedLabel[] = [PROJECT, AREA, COST, OS, BLUEPRINT];

/** One value of a label as a ship carries it. */
export function carried(label: ListedLabel, value: string): ListedShip['labels'][number] {
  const found = label.values.find((each) => each.value === value);
  if (found === undefined) {
    throw new RangeError(`${label.key} has no value ${value}`);
  }
  return { labelId: label.id, key: label.key, valueId: found.id, value: found.value };
}

/** The plugin ships that own labels, as the fleet lists them, so chips carry their marks. */
export function ownerShips(base: ListedShip): ListedShip[] {
  return [
    { ...base, id: OWNERS.trierarchPlugin.id, name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'agent', labels: [], crewRequest: null },
    { ...base, id: OWNERS.squadrons.id, name: 'squadrons', type: 'squadrons', kind: 'agent', labels: [], crewRequest: null },
  ];
}

/** The context chips and the filter read, for the operator or a viewer. */
export function labelContext(ships: readonly ListedShip[], isOperator = true): LabelContext {
  return labelContextOf(LABELS, { ships, isOperator });
}
