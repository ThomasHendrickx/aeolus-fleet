import type { Clock } from './clock.js';

/**
 * Outbound port: counts the fleets this installation hosts. The only read that
 * is not scoped to one fleet, because it counts the fleets themselves.
 */
export interface FleetCounter {
  countFleets(): Promise<number>;
}

export interface PingResult {
  serverTime: Date;
  fleetCount: number;
}

export type Ping = () => Promise<PingResult>;

/** Use case: proves the server can read its clock and reach its database. */
export function createPing(deps: { clock: Clock; fleets: FleetCounter }): Ping {
  return async () => {
    const fleetCount = await deps.fleets.countFleets();
    return { serverTime: deps.clock.now(), fleetCount };
  };
}
