import { describe, expect, it } from 'vitest';

import { checkShipName, NAME_RULE } from './ship-name';

const fleet = { activeNames: ['planner', 'reviewer-01'], current: 'reviewer-01' };

describe('checkShipName', () => {
  it('states the rule while empty', () => {
    expect(checkShipName('', fleet)).toEqual({ kind: 'empty', message: NAME_RULE });
  });

  it('says a free handle is available', () => {
    expect(checkShipName('reviewer-web', fleet)).toEqual({ kind: 'available', message: 'reviewer-web is available.' });
  });

  it('says a name an active ship holds is taken', () => {
    expect(checkShipName('planner', fleet)).toEqual({ kind: 'taken', message: 'planner is already used by an active ship.' });
  });

  it('says the ship already has the name it has', () => {
    expect(checkShipName('reviewer-01', fleet).kind).toBe('unchanged');
  });

  it.each(['Planner', 'two words', 'a'.repeat(49)])('says %j is no handle', (name) => {
    expect(checkShipName(name, fleet).kind).toBe('invalid');
  });

  it('takes 48 characters', () => {
    expect(checkShipName('a'.repeat(48), fleet).kind).toBe('available');
  });

  it('says argo is reserved', () => {
    expect(checkShipName('argo', fleet)).toEqual({ kind: 'reserved', message: 'argo is reserved for the operator ship.' });
  });
});
