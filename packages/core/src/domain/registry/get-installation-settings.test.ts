import { describe, expect, it } from 'vitest';

import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { createGetInstallationSettings } from './get-installation-settings.js';

describe("reading the installation's settings", () => {
  it('answers no limit and no retention until one is set: an installation sets none of its own', async () => {
    const core = createInMemoryCore();

    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      defaultRetentionDays: null,
      fleetCap: null,
    });
  });
});
