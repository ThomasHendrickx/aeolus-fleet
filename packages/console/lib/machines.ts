import type { CrewStatus, ListedShip } from '@aeolus-fleet/common';

import type { Machine } from './trierarch-plugin';

/**
 * What the Trierarchs section shows of a machine (canvas TrierarchPlugin):
 * whether its trierarch answers, its capacity from the crew requests assigned
 * to it, and the options each harness offers. Pure, from the trierarch
 * plugin's machines and the fleet snapshot.
 */

/** How many machines are silent: the Trierarchs count (docs/design/conventions.md, "Crew requests and trierarchs"). */
export function silentCount(machines: readonly Pick<Machine, 'isSilent'>[]): number {
  return machines.filter((machine) => machine.isSilent).length;
}

/** Whether a machine's trierarch answers: alive, silent, or never crewed yet (joined, its setup line not run). */
export function machineLiveness(machine: Pick<Machine, 'status' | 'isSilent' | 'lastSeenAt'>): 'alive' | 'silent' | 'not-started' {
  if (machine.status === 'awaitingCrew' && machine.lastSeenAt === null) {
    return 'not-started';
  }
  return machine.isSilent ? 'silent' : 'alive';
}

/** One spot of a machine: a ship it crews, with its crew status, its restart attempt and when its session started (#332). */
export interface Spot {
  shipId: ListedShip['id'];
  name: string;
  status: CrewStatus;
  attempt: number;
  startedAt: string | null;
}

/** The order spots show in: running first, then what needs a look, then what is on its way. */
const SPOT_ORDER: readonly CrewStatus[] = ['running', 'crashed', 'restarting', 'crewing', 'releasing'];

/** The ships whose crew requests are assigned to the machine's trierarch, as spots; a request with no status yet is crewing. */
export function spotsOf(machine: Pick<Machine, 'shipId'>, ships: readonly ListedShip[]): Spot[] {
  return ships
    .flatMap((ship) =>
      ship.crewRequest?.assignedTo?.id === machine.shipId
        ? [{ shipId: ship.id, name: ship.name, status: ship.crewRequest.status ?? 'crewing', attempt: ship.crewRequest.attempt, startedAt: ship.crewRequest.startedAt }]
        : [],
    )
    .toSorted((one, other) => SPOT_ORDER.indexOf(one.status) - SPOT_ORDER.indexOf(other.status) || one.name.localeCompare(other.name));
}

/**
 * A machine's capacity in words: "4 of 6 running · 1 crashed · 1 crewing ·
 * full", out of the ships it crews at most; unknown until it reported.
 */
export function capacityLine(spots: readonly Spot[], caps: { ships: number } | undefined): string | undefined {
  if (caps === undefined) {
    return undefined;
  }
  const count = (status: CrewStatus) => spots.filter((spot) => spot.status === status).length;
  const others = SPOT_ORDER.slice(1).flatMap((status) => (count(status) === 0 ? [] : [`${String(count(status))} ${status}`]));
  const isFull = spots.length >= caps.ships;
  return [`${String(count('running'))} of ${String(caps.ships)} running`, ...others, ...(isFull ? ['full'] : [])].join(' · ');
}

/** One option a harness offers: its name, its values in the trierarch's order, and its default when it has one. */
export interface HarnessOption {
  name: string;
  values: string[];
  defaultValue?: string;
}

/**
 * The options a harness offers, from the JSON Schema its trierarch reports
 * (each option one of its value names, with its default). Anything else in
 * the schema is left out.
 */
export function harnessOptions(schema: Readonly<Record<string, unknown>>): HarnessOption[] {
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null) {
    return [];
  }
  return Object.entries(properties).flatMap(([name, option]: [string, unknown]) => {
    if (typeof option !== 'object' || option === null || !('enum' in option) || !Array.isArray(option.enum)) {
      return [];
    }
    const values = option.enum.filter((value): value is string => typeof value === 'string');
    const fallback = 'default' in option && typeof option.default === 'string' ? option.default : undefined;
    return [{ name, values, ...(fallback === undefined ? {} : { defaultValue: fallback }) }];
  });
}
