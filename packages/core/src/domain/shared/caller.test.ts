import { accountIdSchema, createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { actorOf, hasScope, isCrew, type ShipCaller, type Crew } from './caller.js';

const newId = createIdGenerator();

describe('hasScope', () => {
  const agent: ShipCaller = {
    shipId: newId('ship'),
    fleetId: newId('fleet'),
    kind: 'agent',
    scopes: ['messages:send', 'messages:receive'],
  };

  it('grants a scope the ship holds', () => {
    expect(hasScope(agent, 'messages:send')).toBe(true);
  });

  it('refuses a scope the ship does not hold', () => {
    expect(hasScope(agent, 'fleet:read')).toBe(false);
    expect(hasScope(agent, 'fleet:manage')).toBe(false);
  });
});

describe('isCrew', () => {
  const caller: ShipCaller = { shipId: newId('ship'), fleetId: newId('fleet'), kind: 'operator', scopes: ['fleet:read'] };

  it('knows a caller that crews its ship under a lease', () => {
    const crew: Crew = { ...caller, leaseId: newId('lease') };

    expect(isCrew(crew)).toBe(true);
  });

  it('knows a caller without a lease is no crew', () => {
    expect(isCrew(caller)).toBe(false);
  });
});

describe('actorOf', () => {
  const argo: ShipCaller = { shipId: newId('ship'), fleetId: newId('fleet'), kind: 'operator', scopes: [] };

  it('names argo with the account signed in to the console as it, by its id (decision 0054)', () => {
    const signedInAccountId = accountIdSchema.parse('acc-01lena');

    expect(actorOf({ ...argo, signedInAccountId })).toEqual({ kind: 'ship', shipId: argo.shipId, signedInAccountId });
  });

  it('names a ship alone when no account signed in as it', () => {
    expect(actorOf(argo)).toEqual({ kind: 'ship', shipId: argo.shipId });
  });
});
