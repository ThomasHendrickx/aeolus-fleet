import type { CountedLabel, ListedLabel, ListedShip, ShipId } from '@aeolus-fleet/common';
import { isLabelHandle, LABEL_HANDLE_MAX_LENGTH } from '@aeolus-fleet/common/rules';

/**
 * Labels as the console shows them (#102, canvas Labels; decision 0031):
 * chips of `key=value`, each marked by who owns its label, the filter's keys
 * grouped by owner with how many ships carry each value, and which ships
 * carry every value picked. Pure, from the fleet's labels with their counts
 * and the ships a screen names, never the whole fleet (decision 4 of the
 * performance design).
 */

/**
 * How a chip marks its label's owner (canvas Labels, Q10): none on the
 * signed-in operator's own labels, a ship wheel for the trierarch plugin's,
 * boxes for squadrons', the ship icon for any other owner's.
 */
export type OwnerMark = 'none' | 'trierarch-plugin' | 'squadrons' | 'ship';

/**
 * How a chip marks its label: by its owner, or gone, a crossed-out tag, for a
 * label the fleet no longer has: a reach refusal keeps the values a ship
 * carried then, not who owned them (#523).
 */
export type ChipMark = OwnerMark | 'gone';

/** The ship types whose labels carry their own mark. */
const PLUGIN_MARKS: Readonly<Record<string, OwnerMark>> = { 'trierarch-plugin': 'trierarch-plugin', squadrons: 'squadrons' };

/** One value a ship carries, as a chip shows it. */
export interface LabelChip {
  labelId: ListedLabel['id'];
  valueId: ListedLabel['values'][number]['id'];
  key: string;
  value: string;
  mark: ChipMark;
  /** The owner's name, for a chip's accessible name and the ship page's "by squadrons"; empty for a label that is gone. */
  ownerName: string;
}

/** The fleet's labels as chips and the filter read them: each label's owner and how its chips mark it. */
export interface LabelContext {
  labels: readonly CountedLabel[];
  ownerOf: ReadonlyMap<string, { name: string; mark: OwnerMark; isYours: boolean }>;
  /** The ships the screen names: the labels' owners and the ones it asked for. */
  ships: readonly ListedShip[];
}

/** Whose a label is, as people read it: its owner ship's name, or the installation's (decision 0031). */
export function labelOwnerName(owner: ListedLabel['owner']): string {
  return owner.kind === 'ship' ? owner.name : 'the installation';
}

/** The ship that owns a label; none for the installation's. */
function labelOwnerShipId(owner: ListedLabel['owner']): ShipId | undefined {
  return owner.kind === 'ship' ? owner.id : undefined;
}

/**
 * The context chips and the filter read: whose each label is, and its mark.
 * The operator's own labels are argo's; a viewer owns none, so it sees every
 * label by its owner.
 */
export function labelContextOf(labels: readonly CountedLabel[], fleet: { ships: readonly ListedShip[]; isOperator: boolean }): LabelContext {
  const typeOf = new Map(fleet.ships.map((ship) => [ship.id, ship]));
  const ownerOf = new Map(
    labels.map((label) => {
      const ownerShipId = labelOwnerShipId(label.owner);
      const owner = ownerShipId === undefined ? undefined : typeOf.get(ownerShipId);
      const isYours = fleet.isOperator && owner?.kind === 'operator';
      const mark: OwnerMark = isYours ? 'none' : (PLUGIN_MARKS[owner?.type ?? ''] ?? 'ship');
      return [label.id, { name: labelOwnerName(label.owner), mark, isYours }];
    }),
  );
  return { labels, ownerOf, ships: fleet.ships };
}

/** A ship's labels as chips: yours first, then others', each by key and value. */
export function chipsOf(ship: Pick<ListedShip, 'labels'>, context: LabelContext): LabelChip[] {
  const isYours = (chip: LabelChip) => context.ownerOf.get(chip.labelId)?.isYours ?? false;
  return ship.labels
    .map((carried): LabelChip => {
      const owner = context.ownerOf.get(carried.labelId);
      return { labelId: carried.labelId, valueId: carried.valueId, key: carried.key, value: carried.value, mark: owner?.mark ?? 'gone', ownerName: owner?.name ?? '' };
    })
    .toSorted((one, other) => Number(isYours(other)) - Number(isYours(one)) || one.key.localeCompare(other.key) || one.value.localeCompare(other.value));
}

/** A chip's title: `key=value` and whose label it is, or that the label no longer exists. */
export function chipTitleOf(chip: Pick<LabelChip, 'key' | 'value' | 'mark' | 'ownerName'>): string {
  const text = `${chip.key}=${chip.value}`;
  switch (chip.mark) {
    case 'none':
      return `${text}, by you`;
    case 'gone':
      return `${text}, a label that no longer exists`;
    case 'trierarch-plugin':
    case 'squadrons':
    case 'ship':
      return `${text}, by ${chip.ownerName}`;
  }
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
  labelId: ListedLabel['id'];
  key: string;
  mark: OwnerMark;
  values: { valueId: ListedLabel['values'][number]['id']; value: string; shipCount: number }[];
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
  const groups = new Map<string, { title: string; isYours: boolean; keys: FilterKey[] }>();
  for (const label of context.labels) {
    const owner = context.ownerOf.get(label.id);
    const isYours = owner?.isYours ?? false;
    const title = isYours ? 'Yours' : `By ${labelOwnerName(label.owner)}`;
    const group = groups.get(title) ?? { title, isYours, keys: [] };
    group.keys.push({
      labelId: label.id,
      key: label.key,
      mark: owner?.mark ?? 'ship',
      values: label.values.map((value) => ({ valueId: value.id, value: value.value, shipCount: value.shipCount })),
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
    return [{ labelId: label.id, valueId: value.id, key: label.key, value: value.value, mark: owner?.mark ?? 'ship', ownerName: owner?.name ?? labelOwnerName(label.owner) }];
  });
}

/** One label as the Labels page lists it (canvas Labels, LbList). */
export interface LabelRow {
  labelId: ListedLabel['id'];
  key: string;
  owner: { name: string; isYours: boolean; mark: OwnerMark };
  values: { valueId: ListedLabel['values'][number]['id']; value: string; shipCount: number }[];
  /** How many ships that are not retired carry any of its values. */
  shipCount: number;
}

/** The Labels page's rows: yours first, then by owner name, each owner's by key. */
export function labelRowsOf(context: LabelContext): LabelRow[] {
  return context.labels
    .map((label) => {
      const owner = context.ownerOf.get(label.id);
      return {
        labelId: label.id,
        key: label.key,
        owner: { name: labelOwnerName(label.owner), isYours: owner?.isYours ?? false, mark: owner?.mark ?? 'ship' },
        values: label.values.map((value) => ({ valueId: value.id, value: value.value, shipCount: value.shipCount })),
        shipCount: label.shipCount,
      };
    })
    .toSorted(
      (one, other) =>
        Number(other.owner.isYours) - Number(one.owner.isYours) || one.owner.name.localeCompare(other.owner.name) || one.key.localeCompare(other.key),
    );
}

/** Whether a row matches the Labels page's search: its key or one of its values holds the text, ignoring case. */
export function matchesLabelQuery(row: Pick<LabelRow, 'key' | 'values'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || row.key.includes(needle) || row.values.some((value) => value.value.includes(needle));
}

/**
 * What is wrong with a key or value as typed, in the words the Define and
 * Values dialogs show under the field (canvas LbDefineInvalid); undefined when
 * it is fine. The server checks the same rule (decision 0031).
 */
export function labelTextProblem(text: string, field: 'Key' | 'Value'): string | undefined {
  if (text === '' || isLabelHandle(text)) {
    return undefined;
  }
  return `${field}: use lowercase letters, digits and - only, at most ${String(LABEL_HANDLE_MAX_LENGTH)} characters (decision 0031).`;
}

/** From how many labels a ship's page counts them, "15 of 20" (canvas Labels, Q12): below that it is noise. */
const SHOWN_COUNT_FROM = 15;

/**
 * How a ship stands against the label limit (decision 0031; canvas LbShipLimit,
 * Q12): its count against the most, from 15 on; at the most, Add label goes and
 * the limit is named.
 */
export function labelLimitOf(ship: Pick<ListedShip, 'labels'>, shipLabelsMax: number): { count?: string; isAtLimit: boolean } {
  const carried = ship.labels.length;
  return {
    ...(carried >= SHOWN_COUNT_FROM ? { count: `${String(carried)} of ${String(shipLabelsMax)}` } : {}),
    isAtLimit: carried >= shipLabelsMax,
  };
}

/** Whether you put your labels on this ship from its page: with labels:assign, on any ship but a retired one, argo's own included (decision 0031). */
export function canAssignLabelsTo(ship: Pick<ListedShip, 'status'>, access: { canAssignLabels: boolean }): boolean {
  return access.canAssignLabels && ship.status !== 'retired';
}

/** One of your keys as Add label offers it on a ship: its values with their ships, and which the ship carries. */
export interface AssignKey extends FilterKey {
  carriedValueIds: ListedLabel['values'][number]['id'][];
}

/** Your keys, for Add label and your chips' menus on a ship's page: every value, the ones it carries marked (#102, point 13: a carried key takes another value). */
export function assignKeysOf(ship: Pick<ListedShip, 'labels'>, context: LabelContext): AssignKey[] {
  const yours = filterGroupsOf(context).find((group) => group.title === 'Yours');
  return (yours?.keys ?? []).map((key) => ({
    ...key,
    carriedValueIds: ship.labels.filter((carried) => carried.labelId === key.labelId).map((carried) => carried.valueId),
  }));
}

/** "a", "a and b", "a, b and c". */
export function listed(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/** One label a retiring ship owns, with how many other ships that are not retired carry it. */
export interface OwnedLabel {
  key: string;
  carrierCount: number;
}

/**
 * What retiring a ship does to labels (canvas LbRetireShip, LbRetireOwner;
 * Q11): the values it carries go, and the labels it owns retire with it, off
 * every ship that carries them, counted as `fleet.labels` counts them rather
 * than named, so the confirm reads no carrier. None when neither.
 */
export function retiredLabelsOf(ship: Pick<ListedShip, 'id' | 'labels'>, context: Pick<LabelContext, 'labels'>): { carried: string[]; owned?: OwnedLabel[] } {
  const carried = ship.labels.map((each) => `${each.key}=${each.value}`);
  const owned = context.labels
    .filter((label) => labelOwnerShipId(label.owner) === ship.id)
    .map((label) => ({ key: label.key, carrierCount: label.shipCount - Number(ship.labels.some((each) => each.labelId === label.id)) }));
  return owned.length === 0 ? { carried } : { carried, owned };
}

/** "1 ship", "3 ships". */
function shipsCounted(count: number): string {
  return `${String(count)} ${count === 1 ? 'ship' : 'ships'}`;
}

/**
 * The retire confirm's lines about labels (canvas LbRetireShip, LbRetireOwner;
 * Q11): the values the ship carries go with it; the labels it owns retire,
 * off every ship that carries them. None without either.
 */
export function retireLabelLines(labels: ReturnType<typeof retiredLabelsOf>): string[] {
  const lines: string[] = [];
  if (labels.carried.length > 0) {
    lines.push(`Its ${labels.carried.length === 1 ? 'label is' : `${String(labels.carried.length)} labels are`} removed with it: ${labels.carried.join(', ')}.`);
  }
  if (labels.owned !== undefined) {
    const keys = labels.owned.map((label) => label.key);
    lines.push(`Its ${keys.length === 1 ? 'label retires' : `${String(keys.length)} labels retire`} with it: ${listed(keys)}. Nobody can assign ${keys.length === 1 ? 'it' : 'them'} again.`);
    const carried = labels.owned.filter((label) => label.carrierCount > 0);
    const [only] = labels.owned;
    if (labels.owned.length === 1 && only !== undefined && only.carrierCount > 0) {
      lines.push(`It is removed from the ${only.carrierCount === 1 ? 'ship that carries' : `${String(only.carrierCount)} ships that carry`} it.`);
    } else if (labels.owned.length > 1 && carried.length > 0) {
      lines.push(`They are removed from the ships that carry them: ${listed(carried.map((label) => `${label.key} from ${shipsCounted(label.carrierCount)}`))}.`);
    }
  }
  return lines;
}
