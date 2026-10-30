/**
 * A fleet's feature flags (decision 0069): each flag common names is on or
 * off for a fleet. Off, the console shows nothing of its feature and core
 * refuses the feature's procedures; a flag cannot go off while the fleet uses
 * its feature. A server without an installation token has no one to set them,
 * so there each flag has its own value.
 */
import { FEATURE_FLAGS, type FeatureFlag, type FleetFeatureFlag, type FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FeatureFlagRepository } from './ports.js';

/** What a fleet uses of the features the flags turn on: today whether it is sealing or sealed. */
export interface FeatureUse {
  isSealing: boolean;
}

/** What the server has that a flag's value without an installation needs: today whether it has a KMS. */
export interface ServerFeatures {
  hasKeyVault: boolean;
}

/**
 * Where a fleet's flags come from: the installation sets them per fleet, or,
 * on a server without an installation token, each flag has its own value.
 */
export type FeatureFlagSource = { kind: 'installation' } | { kind: 'server'; on: readonly FeatureFlag[] };

/** When each flag's feature is in use, so the flag cannot go off: sealing while the fleet is sealing or sealed. */
const IN_USE: Record<FeatureFlag, (use: FeatureUse) => boolean> = {
  sealing: (use) => use.isSealing,
};

/** Each flag's value on a server without an installation token: sealing on when the server has a KMS. */
const ON_WITHOUT_INSTALLATION: Record<FeatureFlag, (server: ServerFeatures) => boolean> = {
  sealing: (server) => server.hasKeyVault,
};

/** The line the installation shows for each flag while the fleet uses its feature: the flag list's own. */
const IN_USE_NOTES: ReadonlyMap<FeatureFlag, string> = new Map(FEATURE_FLAGS.map(({ key, inUseNote }) => [key, inUseNote]));

/** Whether the fleet uses the feature, so its flag cannot go off. */
export function isInUse(flag: FeatureFlag, use: FeatureUse): boolean {
  return IN_USE[flag](use);
}

/** Where the flags come from on this server: the installation when it has a token, else each flag's own value. */
export function featureFlagSource(server: ServerFeatures & { hasInstallation: boolean }): FeatureFlagSource {
  return server.hasInstallation ? { kind: 'installation' } : { kind: 'server', on: FEATURE_FLAGS.filter(({ key }) => ON_WITHOUT_INSTALLATION[key](server)).map(({ key }) => key) };
}

/** Each flag common names, on or off for the fleet, and whether it can go off now. */
export function fleetFeatureFlags(on: readonly FeatureFlag[], use: FeatureUse): FleetFeatureFlag[] {
  return FEATURE_FLAGS.map(({ key }) => fleetFeatureFlag(key, { isOn: on.includes(key), use }));
}

export function fleetFeatureFlag(flag: FeatureFlag, state: { isOn: boolean; use: FeatureUse }): FleetFeatureFlag {
  return { flag, isOn: state.isOn, canTurnOff: !isInUse(flag, state.use) };
}

/** The line the installation shows while the fleet uses the feature: the flag list's own. */
export function inUseNote(flag: FeatureFlag): string {
  return IN_USE_NOTES.get(flag) ?? `The fleet uses ${flag}`;
}

export type FeatureFlagOff = DomainError<'FEATURE_FLAG_OFF'>;

/** A feature's procedure answers this while its flag is off, changing nothing. */
export function requireFeatureFlag(flag: FeatureFlag, isOn: boolean): Result<void, FeatureFlagOff> {
  return isOn ? ok(undefined) : refuse('FEATURE_FLAG_OFF', `The ${flag} feature flag is off for this fleet`);
}

/** The flags on for the fleet, from where this server's flags come from. */
export async function featureFlagsOn(reads: FeatureFlagReads, fleetId: FleetId): Promise<readonly FeatureFlag[]> {
  return reads.source.kind === 'server' ? reads.source.on : reads.flags.onFor(fleetId);
}

/** Whether the flag is on for the fleet, held until the unit of work ends where the installation sets it, so it cannot go off before the feature is in use. */
export async function isFeatureFlagOnForUpdate(
  held: { source: FeatureFlagSource; flags: Pick<FeatureFlagRepository, 'isOnForUpdate'> },
  at: { fleetId: FleetId; flag: FeatureFlag },
): Promise<boolean> {
  return held.source.kind === 'server' ? held.source.on.includes(at.flag) : held.flags.isOnForUpdate(at.fleetId, at.flag);
}

/** The fleets' feature flags as a feature's procedures read them: where this server's come from, and the installation's rows, read outside a unit of work. */
export interface FeatureFlagReads {
  source: FeatureFlagSource;
  flags: Pick<FeatureFlagRepository, 'onFor'>;
}

/** Refuses a feature's procedure FEATURE_FLAG_OFF while the fleet's flag for it is off. */
export async function checkFeatureFlag(reads: FeatureFlagReads, at: { fleetId: FleetId; flag: FeatureFlag }): Promise<Result<void, FeatureFlagOff>> {
  return requireFeatureFlag(at.flag, (await featureFlagsOn(reads, at.fleetId)).includes(at.flag));
}
