import { pickedChips, type FilterGroup, type FilterKey, type LabelChip, type LabelContext } from './labels';

/**
 * A crew request's machine labels as the console shows them (#102; canvas
 * Labels, LbRequest, LbRequestPicking, LbRequestTwo, LbRequestNoMatch): the
 * trierarch plugin places a request only on a machine whose trierarch ship
 * carries every label value it asks for, exact matches combined with AND
 * (docs/trierarch.md, "Assignment"). Pure, from the fleet's labels, its ships
 * and the machines the plugin lists.
 */

/** A machine as the matching reads it: its trierarch's ship and its name. */
export interface MachineRef {
  shipId: string;
  name: string;
}

/** The machines that carry every label picked, by name, of all the machines. */
export interface MachineMatch {
  matching: string[];
  total: number;
}

/** The label value ids the machine's trierarch ship carries; none when the fleet does not list it. */
function carriedBy(context: LabelContext, machine: MachineRef): string[] {
  return context.ships.find((ship) => ship.id === machine.shipId)?.labels.map((carried) => carried.valueId) ?? [];
}

/** "Matches 2 of 3 machines": which machines carry every value picked; with none picked, every machine. */
export function machineMatchOf(context: LabelContext, pick: { machines: readonly MachineRef[]; valueIds: readonly string[] }): MachineMatch {
  const matching = pick.machines.filter((machine) => {
    const carried = carriedBy(context, machine);
    return pick.valueIds.every((valueId) => carried.includes(valueId));
  });
  return { matching: matching.map((machine) => machine.name), total: pick.machines.length };
}

/**
 * The machine label picker's keys (canvas LbRequestPicking): the keys some
 * machine carries first, "On machines", then "On no machine yet"; each value
 * with how many machines carry it. Any owner's label may be asked for.
 */
export function machineLabelGroupsOf(context: LabelContext, machines: readonly MachineRef[]): FilterGroup[] {
  const carried = machines.map((machine) => carriedBy(context, machine));
  const onMachines: FilterKey[] = [];
  const onNone: FilterKey[] = [];
  for (const label of context.labels) {
    const values = label.values.map((value) => ({ valueId: value.id, value: value.value, shipCount: carried.filter((ids) => ids.includes(value.id)).length }));
    const key = { labelId: label.id, key: label.key, mark: context.ownerOf.get(label.id)?.mark ?? 'ship', values };
    (values.some((each) => each.shipCount > 0) ? onMachines : onNone).push(key);
  }
  const byKey = (one: FilterKey, other: FilterKey) => one.key.localeCompare(other.key);
  return [
    { title: 'On machines', keys: onMachines.toSorted(byKey) },
    { title: 'On no machine yet', keys: onNone.toSorted(byKey) },
  ].filter((group) => group.keys.length > 0);
}

/** How the no-match note words the labels picked: "No machine matches both", "until a machine carries both". */
export function noMatchWords(count: number): { these: string; carries: string } {
  if (count === 1) {
    return { these: 'this label', carries: 'carries it' };
  }
  return count === 2 ? { these: 'both', carries: 'carries both' } : { these: 'these labels', carries: 'carries them all' };
}

/** What the Request crew form needs for machine labels: the picker's keys, the chips of the values picked and which machines carry them. */
export interface MachineLabelsInput {
  groups: FilterGroup[];
  chipsOf: (valueIds: readonly string[]) => LabelChip[];
  matchOf: (valueIds: readonly string[]) => MachineMatch;
}

/** The form's machine labels from the fleet's labels and the machines the plugin lists. */
export function machineLabelsInputOf(context: LabelContext, machines: readonly MachineRef[]): MachineLabelsInput {
  return {
    groups: machineLabelGroupsOf(context, machines),
    chipsOf: (valueIds) => pickedChips(valueIds, context),
    matchOf: (valueIds) => machineMatchOf(context, { machines, valueIds }),
  };
}
