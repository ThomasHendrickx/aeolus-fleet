import type { ListedLabel, ListedShip } from '@aeolus-fleet/common';

/**
 * Labels as the console shows them (#102, canvas Labels; decision 0031):
 * chips of `key=value`, each marked by who owns its label, the filter's keys
 * grouped by owner with how many ships carry each value, and which ships
 * carry every value picked. Pure, from the fleet's labels and its ships.
 */

/**
 * How a chip marks its label's owner (canvas Labels, Q10): none on the
 * signed-in operator's own labels, a ship wheel for the trierarch plugin's,
 * boxes for squadrons', the ship icon for any other owner's.
 */
export type OwnerMark = 'none' | 'trierarch-plugin' | 'squadrons' | 'ship';

/** The ship types whose labels carry their own mark. */
const PLUGIN_MARKS: Readonly<Record<string, OwnerMark>> = { 'trierarch-plugin': 'trierarch-plugin', squadrons: 'squadrons' };

/** One value a ship carries, as a chip shows it. */
export interface LabelChip {
  labelId: string;
  valueId: string;
  key: string;
  value: string;
  mark: OwnerMark;
  /** The owner's name, for a chip's accessible name and the ship page's "by squadrons". */
  ownerName: string;
}

/** The fleet's labels as chips and the filter read them: each label's owner and how its chips mark it. */
export interface LabelContext {
  labels: readonly ListedLabel[];
  ownerOf: ReadonlyMap<string, { name: string; mark: OwnerMark; isYours: boolean }>;
  /** The ships, by id, for how many carry each value. */
  ships: readonly ListedShip[];
}

/**
 * The context chips and the filter read: whose each label is, and its mark.
 * The operator's own labels are argo's; a viewer owns none, so it sees every
 * label by its owner.
 */
export function labelContextOf(labels: readonly ListedLabel[], fleet: { ships: readonly ListedShip[]; isOperator: boolean }): LabelContext {
  const typeOf = new Map(fleet.ships.map((ship) => [ship.id, ship]));
  const ownerOf = new Map(
    labels.map((label) => {
      const owner = typeOf.get(label.owner.id);
      const isYours = fleet.isOperator && owner?.kind === 'operator';
      const mark: OwnerMark = isYours ? 'none' : (PLUGIN_MARKS[owner?.type ?? ''] ?? 'ship');
      return [label.id, { name: label.owner.name, mark, isYours }];
    }),
  );
  return { labels, ownerOf, ships: fleet.ships };
}

/** A ship's labels as chips: yours first, then others', each by key and value. */
export function chipsOf(ship: Pick<ListedShip, 'labels'>, context: LabelContext): LabelChip[] {
  const isYours = (chip: LabelChip) => context.ownerOf.get(chip.labelId)?.isYours ?? false;
  return ship.labels
    .map((carried) => {
      const owner = context.ownerOf.get(carried.labelId);
      return { labelId: carried.labelId, valueId: carried.valueId, key: carried.key, value: carried.value, mark: owner?.mark ?? 'ship', ownerName: owner?.name ?? '' };
    })
    .toSorted((one, other) => Number(isYours(other)) - Number(isYours(one)) || one.key.localeCompare(other.key) || one.value.localeCompare(other.value));
}

/**
 * The chips a row shows before the rest fold into "+n" (canvas Labels, Q2):
 * as many as fit its width, read as characters of `key=value`, and always
 * the first.
 */
export function rowChips(chips: readonly LabelChip[], width: number): { shown: LabelChip[]; folded: LabelChip[] } {
  let used = 0;
  const fits = chips.findIndex((chip, index) => {
    used += chip.key.length + chip.value.length + 1;
    return index > 0 && used > width;
  });
  const cut = fits === -1 ? chips.length : fits;
  return { shown: chips.slice(0, cut), folded: chips.slice(cut) };
}

/** Whether a ship carries every value picked: exact matches, combined with AND (decision 0031). */
export function carriesEvery(ship: Pick<ListedShip, 'labels'>, valueIds: readonly string[]): boolean {
  return valueIds.every((valueId) => ship.labels.some((carried) => carried.valueId === valueId));
}

/** One key of the label filter, with each value and how many ships carry it. */
export interface FilterKey {
  labelId: string;
  key: string;
  mark: OwnerMark;
  values: { valueId: string; value: string; shipCount: number }[];
}

/** The label filter's keys, by owner: "Yours" first, then "By <owner>" in name order. */
export interface FilterGroup {
  title: string;
  keys: FilterKey[];
}

/**
 * The label filter's keys (canvas Labels, Q7): every owner's, yours first,
 * each value with how many ships that are not retired carry it.
 */
export function filterGroupsOf(context: LabelContext): FilterGroup[] {
  const active = context.ships.filter((ship) => ship.status !== 'retired');
  const groups = new Map<string, { title: string; isYours: boolean; keys: FilterKey[] }>();
  for (const label of context.labels) {
    const owner = context.ownerOf.get(label.id);
    const isYours = owner?.isYours ?? false;
    const title = isYours ? 'Yours' : `By ${label.owner.name}`;
    const group = groups.get(title) ?? { title, isYours, keys: [] };
    group.keys.push({
      labelId: label.id,
      key: label.key,
      mark: owner?.mark ?? 'ship',
      values: label.values.map((value) => ({
        valueId: value.id,
        value: value.value,
        shipCount: active.filter((ship) => ship.labels.some((carried) => carried.valueId === value.id)).length,
      })),
    });
    groups.set(title, group);
  }
  return [...groups.values()]
    .toSorted((one, other) => Number(other.isYours) - Number(one.isYours) || one.title.localeCompare(other.title))
    .map(({ title, keys }) => ({ title, keys: keys.toSorted((one, other) => one.key.localeCompare(other.key)) }));
}

/** The values picked in the filter as chips, in the order picked; a value no label has any more is left out. */
export function pickedChips(valueIds: readonly string[], context: LabelContext): LabelChip[] {
  return valueIds.flatMap((valueId) => {
    const label = context.labels.find((each) => each.values.some((value) => value.id === valueId));
    const value = label?.values.find((each) => each.id === valueId);
    if (label === undefined || value === undefined) {
      return [];
    }
    const owner = context.ownerOf.get(label.id);
    return [{ labelId: label.id, valueId, key: label.key, value: value.value, mark: owner?.mark ?? 'ship', ownerName: owner?.name ?? label.owner.name }];
  });
}
