import { describe, expect, it } from 'vitest';

import { asHandle, checkShipName, NAME_RULE, typeHint } from './ship-name';

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

describe('typeHint', () => {
  it('states the rule while empty', () => {
    expect(typeHint('', 0)).toBe('Free text. Pick a type in use or write a new one.');
  });

  it('says a type no ship uses becomes a new type', () => {
    expect(typeHint('auditor', 0)).toBe('No ship uses this type yet. auditor becomes a new type.');
  });

  it('counts the ships of a type in use', () => {
    expect(typeHint('reviewer', 1)).toBe('1 ship uses this type.');
    expect(typeHint('reviewer', 2)).toBe('2 ships use this type.');
  });
});

describe('asHandle', () => {
  it('turns typed uppercase into lowercase, keeping colons, digits and hyphens', () => {
    expect(asHandle('HemmaFeatureA1B2C3:Planner-2')).toBe('hemmafeaturea1b2c3:planner-2');
  });
});

describe('NAME_RULE', () => {
  it('names colons with the other characters a name may hold', () => {
    expect(NAME_RULE).toBe('Lowercase letters, digits, hyphens and colons, up to 48 characters, unique among active ships.');
  });
});
