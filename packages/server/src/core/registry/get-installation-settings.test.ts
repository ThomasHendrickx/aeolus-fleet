import { describe, expect, it } from 'vitest';

import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { createGetInstallationSettings } from './get-installation-settings.js';

describe("reading the installation's settings", () => {
  it('answers no limit for each until one is set: an installation sets no limit of its own', async () => {
    const core = createInMemoryCore();

    await expect(createGetInstallationSettings({ settings: core.installationSettings })()).resolves.toEqual({
      defaultShipLimit: null,
      defaultDailyMessageLimit: null,
      fleetCap: null,
    });
  });
});
