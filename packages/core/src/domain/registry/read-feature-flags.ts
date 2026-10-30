import type { FeatureFlag, FleetId } from '@aeolus-fleet/common';

import { featureFlagsOn, type FeatureFlagSource } from './feature-flag.js';
import type { FeatureFlagRepository } from './ports.js';

export type ReadFeatureFlags = (input: { fleetId: FleetId }) => Promise<readonly FeatureFlag[]>;

/**
 * Use case: the fleet's feature flags that are on (decision 0069), which
 * console.session answers so the console shows nothing of a feature whose
 * flag is off. Where the installation sets them, its rows; on a server
 * without an installation token, each flag's own value.
 */
export function createReadFeatureFlags(deps: { featureFlags: Pick<FeatureFlagRepository, 'onFor'>; source: FeatureFlagSource }): ReadFeatureFlags {
  return ({ fleetId }) => featureFlagsOn({ source: deps.source, flags: deps.featureFlags }, fleetId);
}
