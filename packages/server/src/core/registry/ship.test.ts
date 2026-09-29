import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../shared/errors.js';
import {
  assertCanRelease,
  assertCanRename,
  assertCanRetire,
  assertNameIsNotReserved,
  isReservedShipName,
  operatorShip,
  type Ship,
} from './ship.js';

const newId = createIdGenerator();
const fleetId: FleetId = newId('fleet');
const createdAt = new Date('2026-09-29T12:00:00.000Z');

const argo = operatorShip({ id: newId('ship'), fleetId, createdAt });
const scout: Ship = {
  id: newId('ship'),
  fleetId,
  name: 'scout',
  type: 'reviewer',
  kind: 'agent',
  scopes: ['messages:send', 'messages:receive'],
  note: null,
  createdAt,
  retiredAt: null,
};

function refusal(action: () => void): DomainError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the domain to refuse');
}

describe('the operator ship', () => {
  it('is argo, of kind operator and type operator, holding every scope', () => {
    expect(argo).toMatchObject({
      name: 'argo',
      type: 'operator',
      kind: 'operator',
      scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
      retiredAt: null,
    });
  });

  it('can never be retired', () => {
    const error = refusal(() => {
      assertCanRetire(argo);
    });

    expect(error.code).toBe('OPERATOR_SHIP_IS_PERMANENT');
    expect(error.message).toBe('argo is the operator ship and can never be retired');
  });

  it('can never be released', () => {
    const error = refusal(() => {
      assertCanRelease(argo);
    });

    expect(error.code).toBe('OPERATOR_SHIP_IS_PERMANENT');
    expect(error.message).toBe('argo is the operator ship and can never be released');
  });

  it('can never be renamed', () => {
    const error = refusal(() => {
      assertCanRename(argo, 'helm');
    });

    expect(error.code).toBe('OPERATOR_SHIP_IS_PERMANENT');
    expect(error.message).toBe('argo is the operator ship and can never be renamed');
  });
});

describe('an agent ship', () => {
  it('can be retired, released and renamed', () => {
    expect(() => {
      assertCanRetire(scout);
    }).not.toThrow();
    expect(() => {
      assertCanRelease(scout);
    }).not.toThrow();
    expect(() => {
      assertCanRename(scout, 'lookout');
    }).not.toThrow();
  });

  it('can never be renamed to argo', () => {
    expect(
      refusal(() => {
        assertCanRename(scout, 'argo');
      }).code,
    ).toBe('SHIP_NAME_RESERVED');
  });
});

describe('the reserved name', () => {
  it('is argo', () => {
    expect(isReservedShipName('argo')).toBe(true);
    expect(
      refusal(() => {
        assertNameIsNotReserved('argo');
      }).message,
    ).toBe('The name argo is reserved for the operator ship');
  });

  it.each(['scout', 'argo-2', 'argonaut'])('leaves %s free', (name) => {
    expect(isReservedShipName(name)).toBe(false);
    expect(() => {
      assertNameIsNotReserved(name);
    }).not.toThrow();
  });
});
