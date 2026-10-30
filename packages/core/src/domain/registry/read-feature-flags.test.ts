import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { featureFlagSource } from './feature-flag.js';
import { createReadFeatureFlags } from './read-feature-flags.js';

let core: InMemoryCore;
let fleetId: FleetId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-30T12:00:00.000Z');
  ({ fleetId } = await hostedFleet(core));
});

describe("reading a fleet's feature flags, as console.session answers them (decision 0069)", () => {
  it('answers the flags the installation turned on for the fleet', async () => {
    const readFeatureFlags = createReadFeatureFlags({ featureFlags: core.featureFlags, source: featureFlagSource({ hasInstallation: true, hasKeyVault: true }) });
    core.state.featureFlags.push({ fleetId, flag: 'sealing' });

    expect(await readFeatureFlags({ fleetId })).toEqual(['sealing']);
  });

  it('answers no flag for a fleet the installation turned none on, though the server has a KMS', async () => {
    const readFeatureFlags = createReadFeatureFlags({ featureFlags: core.featureFlags, source: featureFlagSource({ hasInstallation: true, hasKeyVault: true }) });

    expect(await readFeatureFlags({ fleetId })).toEqual([]);
  });

  it('answers sealing on, on a server without an installation token that has a KMS', async () => {
    const readFeatureFlags = createReadFeatureFlags({ featureFlags: core.featureFlags, source: featureFlagSource({ hasInstallation: false, hasKeyVault: true }) });

    expect(await readFeatureFlags({ fleetId })).toEqual(['sealing']);
  });

  it('answers sealing off, on a server without an installation token or a KMS', async () => {
    const readFeatureFlags = createReadFeatureFlags({ featureFlags: core.featureFlags, source: featureFlagSource({ hasInstallation: false, hasKeyVault: false }) });

    expect(await readFeatureFlags({ fleetId })).toEqual([]);
  });
});
