import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { readHealthOf } from '../shared/health-read.js';
import type { HealthSnapshots } from '../shared/health-snapshot.js';
import type { HealthRecords } from '../shared/health.js';
import { ok, type Result } from '../shared/result.js';
import { installationFleet, messageWindow, type InstallationFleet } from './installation-fleet.js';
import type { InstallationFleets, InstallationSettingsRepository } from './ports.js';

/** The reads one fleet's description awaits, in their order: its facts, the installation's settings, its latest stuck snapshot and its health. */
export type InstallationFleetStep = 'find' | 'settings' | 'latest' | 'health';

/** Told each step once it answered, with the milliseconds it took: a read that never answers is the first step not told (#1523). */
export type StepTaken = (step: InstallationFleetStep, ms: number) => void;

export type GetInstallationFleet = (input: { fleetId: FleetId }, stepTaken?: StepTaken) => Promise<Result<InstallationFleet, DomainError<'FLEET_NOT_FOUND'>>>;

/** Use case: one fleet of the installation, described as the list describes it. */
export function createGetInstallationFleet(deps: {
  fleets: InstallationFleets;
  settings: InstallationSettingsRepository;
  health: HealthRecords;
  snapshots: HealthSnapshots;
  clock: Clock;
}): GetInstallationFleet {
  return async ({ fleetId }, stepTaken = () => undefined) => {
    const timed = async <T>(step: InstallationFleetStep, read: () => Promise<T>): Promise<T> => {
      const started = deps.clock.now().getTime();
      const answer = await read();
      stepTaken(step, deps.clock.now().getTime() - started);
      return answer;
    };
    const now = deps.clock.now();
    const facts = await timed('find', () => deps.fleets.find(fleetId, messageWindow(now)));
    if (!facts) {
      return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
    }
    const installation = await timed('settings', () => deps.settings.read());
    const snapshots: HealthSnapshots = { ...deps.snapshots, latest: (id) => timed('latest', () => deps.snapshots.latest(id)) };
    const health = await timed('health', () => readHealthOf({ records: deps.health, snapshots }, { fleetId, now }));
    return ok(installationFleet(facts, { now, installation, health }));
  };
}
