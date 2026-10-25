import { harnessOptions } from '../../../lib/machines';
import type { Machine } from '../../../lib/trierarch-plugin-schemas';

/**
 * The Models section's rows (model governance, M7): one per model id that a
 * trierarch reports or the fleet enables, with the harnesses that report it
 * and how many machines do. A silent machine counts by its last report: the
 * operator decides on what the fleet's machines can run, not on who answers
 * this minute.
 */

/** The crew settings option that names the model a session runs. */
const MODEL_OPTION = 'model';

export interface ModelRow {
  model: string;
  /** The harnesses that report it, in the order the machines report them; none when no trierarch reports it. */
  harnesses: string[];
  machineCount: number;
  isEnabled: boolean;
}

/** Reported models first, in the order the machines report them, then the enabled ones no trierarch reports. */
export function modelRowsOf(machines: readonly Machine[], enabledModels: readonly string[]): ModelRow[] {
  const rows: ModelRow[] = [];
  const rowOf = (model: string): ModelRow => {
    let row = rows.find((each) => each.model === model);
    if (row === undefined) {
      row = { model, harnesses: [], machineCount: 0, isEnabled: enabledModels.includes(model) };
      rows.push(row);
    }
    return row;
  };
  for (const machine of machines) {
    const reported = new Set<string>();
    for (const harness of machine.details?.harnesses ?? []) {
      const models = harnessOptions(harness.options).find((option) => option.name === MODEL_OPTION)?.values ?? [];
      for (const model of models) {
        const row = rowOf(model);
        if (!row.harnesses.includes(harness.harness)) {
          row.harnesses.push(harness.harness);
        }
        reported.add(model);
      }
    }
    for (const model of reported) {
      rowOf(model).machineCount += 1;
    }
  }
  for (const model of enabledModels) {
    rowOf(model);
  }
  return rows;
}

/**
 * Whether flipping one Switch changes the whole fleet, so it asks first:
 * enabling the first model starts the rule, disabling the last ends it.
 */
export function fleetWideChangeOf(enabledModels: readonly string[], change: { model: string; isEnabled: boolean }): 'first' | 'last' | undefined {
  if (change.isEnabled) {
    return enabledModels.length === 0 ? 'first' : undefined;
  }
  return enabledModels.length === 1 && enabledModels[0] === change.model ? 'last' : undefined;
}
