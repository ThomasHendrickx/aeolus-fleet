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

/** Whether the fleet uses the feature, so its flag cannot go off: sealing while the fleet is sealing or sealed. */
export function isInUse(flag: FeatureFlag, use: FeatureUse): boolean {
  switch (flag) {
    case 'sealing':
      return use.isSealing;
  }
}

/** A flag's value on a server without an installation token: sealing on when the server has a KMS. */
function isOnWithoutInstallation(flag: FeatureFlag, server: ServerFeatures): boolean {
  switch (flag) {
    case 'sealing':
      return server.hasKeyVault;
  }
}

/** Where the flags come from on this server: the installation when it has a token, else each flag's own value. */
export function featureFlagSource(server: ServerFeatures & { hasInstallation: boolean }): FeatureFlagSource {
  return server.hasInstallation ? { kind: 'installation' } : { kind: 'server', on: FEATURE_FLAGS.filter(({ key }) => isOnWithoutInstallation(key, server)).map(({ key }) => key) };
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
  return FEATURE_FLAGS.find(({ key }) => key === flag)?.inUseNote ?? `The fleet uses ${flag}`;
}

export type FeatureFlagOff = DomainError<'FEATURE_FLAG_OFF'>;

/** A feature's procedure answers this while its flag is off, changing nothing. */
export function requireFeatureFlag(flag: FeatureFlag, isOn: boolean): Result<void, FeatureFlagOff> {
  return isOn ? ok(undefined) : refuse('FEATURE_FLAG_OFF', `The ${flag} feature flag is off for this fleet`);
}

/** The flags on for the fleet, from where this server's flags come from. */
export async function featureFlagsOn(source: FeatureFlagSource, flags: Pick<FeatureFlagRepository, 'onFor'>, fleetId: FleetId): Promise<readonly FeatureFlag[]> {
  return source.kind === 'server' ? source.on : flags.onFor(fleetId);
}

/** Whether the flag is on for the fleet, held until the unit of work ends where the installation sets it, so it cannot go off before the feature is in use. */
export async function isFeatureFlagOnForUpdate(source: FeatureFlagSource, flags: Pick<FeatureFlagRepository, 'isOnForUpdate'>, at: { fleetId: FleetId; flag: FeatureFlag }): Promise<boolean> {
  return source.kind === 'server' ? source.on.includes(at.flag) : flags.isOnForUpdate(at.fleetId, at.flag);
}
