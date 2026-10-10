import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { suppliedFleet } from '../../../test/support/supplied-fleet.js';
import { createSaveDeclaration } from './save-declaration.js';

let parts: Awaited<ReturnType<typeof suppliedFleet>>;
let saveDeclaration: ReturnType<typeof createSaveDeclaration>;

beforeEach(async () => {
  parts = await suppliedFleet();
  saveDeclaration = createSaveDeclaration({ networks: parts.networks, supplies: parts.supplies });
});

describe('saving what argo declares for while the plugin is unavailable', () => {
  it('keeps it and registers again with it at once', async () => {
    const declaration = { whileUnavailable: 'open-all', notRespondingAfterSeconds: 900 } as const;

    await expect(saveDeclaration({ fleetId: FLEET_ID, declaration })).resolves.toEqual({ declaration, supply: 'supplied' });
    expect(parts.fleet.state.plugin).toEqual(declaration);
    await expect(parts.networks.find(FLEET_ID)).resolves.toMatchObject({ declaration });
  });

  it('keeps the rules argo saved, and supplies them again', async () => {
    const rules = [{ from: [], to: [] }];
    await parts.networks.save(FLEET_ID, { rules, declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 } });

    await saveDeclaration({ fleetId: FLEET_ID, declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 60 } });

    await expect(parts.networks.find(FLEET_ID)).resolves.toMatchObject({ rules });
    expect(parts.fleet.state.rules).toEqual(rules);
  });
});
