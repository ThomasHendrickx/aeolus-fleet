import { describe, expect, it } from 'vitest';

import { FLEET_ID, memoryFleetNetworks } from '../../../test/support/connection-fakes.js';
import { createReadNetwork } from './read-network.js';

describe("reading a fleet's network", () => {
  it('is no rules, all-to-all, and keep-latest after 300 seconds before argo saved anything', async () => {
    await expect(createReadNetwork({ networks: memoryFleetNetworks() })(FLEET_ID)).resolves.toEqual({
      rules: null,
      declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 },
    });
  });

  it('is what argo saved last', async () => {
    const networks = memoryFleetNetworks();
    const network = { rules: [], declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 60 } } as const;
    await networks.save(FLEET_ID, network);

    await expect(createReadNetwork({ networks })(FLEET_ID)).resolves.toEqual(network);
  });
});
