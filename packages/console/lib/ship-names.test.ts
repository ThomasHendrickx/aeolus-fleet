import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { shipNamesOf } from './ship-names';

const newId = createIdGenerator();

describe('the names of listed ships', () => {
  it('hold a ship the session reads whole', () => {
    const squadrons = { id: newId('ship'), name: 'squadrons' };

    expect(shipNamesOf([squadrons]).get(squadrons.id)).toBe('squadrons');
  });

  it('hold a ship outside the read reach too, as it shows its name', () => {
    const trierarchPlugin = { id: newId('ship'), name: 'trierarch-plugin', isInReadReach: false };

    expect(shipNamesOf([trierarchPlugin]).get(trierarchPlugin.id)).toBe('trierarch-plugin');
  });
});
