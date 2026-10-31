import type { Machine, UsageValuesPage } from '../../../lib/trierarch-plugin-schemas';

/**
 * The machines sending no usage (usage design, "States", partial): those the
 * trierarch plugin lists that have no usage in the range, by `usage.values`
 * with breakdown machine, which is not narrowed by the page's filters. A
 * machine on a page not yet read may have usage, so none is named until every
 * page of values is read; names wait for both reads too.
 */
export function machinesSendingNoUsage(machines: readonly Pick<Machine, 'shipId' | 'name'>[] | undefined, machineValues: UsageValuesPage | undefined): string[] {
  if (machines === undefined || machineValues?.nextCursor !== null) {
    return [];
  }
  const sending = new Set(machineValues.values.map((one) => one.value));
  return machines.filter((machine) => !sending.has(machine.shipId)).map((machine) => machine.name);
}
