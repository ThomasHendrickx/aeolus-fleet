import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { toAuthenticatedShip, toConsoleSessionCaller, toFleet, toLease, toShip } from './rows.js';

const newId = createIdGenerator();
const at = new Date('2026-09-29T12:00:00.000Z');
const fleetId = newId('fleet');
const shipId = newId('ship');

const shipRow = {
  id: shipId,
  fleetId,
  name: 'argo',
  type: 'operator',
  kind: 'operator',
  scopes: ['messages:send', 'fleet:read'],
  note: null,
  createdAt: at,
  retiredAt: null,
  commissionedBy: null,
  commissionKey: null,
  commissionRequestHash: null,
};

describe('mapping rows to domain objects', () => {
  it('maps a fleet row', () => {
    expect(toFleet({ id: fleetId, name: 'home fleet', createdAt: at })).toEqual({
      id: fleetId,
      name: 'home fleet',
      createdAt: at,
    });
  });

  it('maps a ship row, leaving out columns the domain does not know', () => {
    const { commissionedBy, commissionKey, commissionRequestHash, ...columns } = shipRow;
    expect([commissionedBy, commissionKey, commissionRequestHash]).toEqual([null, null, null]);
    expect(toShip({ ...shipRow, unknownColumn: 1 })).toEqual({ ...columns, commission: null });
  });

  it('maps a lease as raw SQL returns it, in snake_case', () => {
    const leaseId = newId('lease');

    expect(
      toLease({
        id: leaseId,
        fleet_id: fleetId,
        ship_id: shipId,
        location: 'OTHER',
        location_description: 'web console',
        harness: null,
        crew_token_hash: null,
        started_at: at,
        ended_at: null,
      }),
    ).toEqual({
      id: leaseId,
      fleetId,
      shipId,
      location: { kind: 'OTHER', description: 'web console' },
      harness: null,
      crewTokenHash: null,
      startedAt: at,
      endedAt: null,
    });
  });

  it("maps a lease with the hash of its session's crew token", () => {
    expect(
      toLease({
        id: newId('lease'),
        fleet_id: fleetId,
        ship_id: shipId,
        location: 'DEVICE',
        location_description: null,
        harness: 'claude-code',
        crew_token_hash: 'sha256(aeolus_ct_v1_crew)',
        started_at: at,
        ended_at: null,
      }),
    ).toMatchObject({ location: { kind: 'DEVICE', description: null }, harness: 'claude-code', crewTokenHash: 'sha256(aeolus_ct_v1_crew)' });
  });

  it('maps the caller of a console session, with the lease it holds on argo and the expiry its use moved to', () => {
    const consoleSessionId = newId('consoleSession');
    const leaseId = newId('lease');
    const expiresAt = new Date('2026-11-04T09:00:00.000Z');

    expect(
      toConsoleSessionCaller({
        console_session_id: consoleSessionId,
        lease_id: leaseId,
        ship_id: shipId,
        fleet_id: fleetId,
        kind: 'operator',
        scopes: ['fleet:read'],
        expires_at: expiresAt,
      }),
    ).toEqual({ caller: { shipId, fleetId, kind: 'operator', scopes: ['fleet:read'], consoleSessionId, leaseId }, expiresAt });
  });

  it('maps the caller of a viewer session, which holds no lease', () => {
    const consoleSessionId = newId('consoleSession');
    const expiresAt = new Date('2026-10-05T11:00:00.000Z');

    expect(
      toConsoleSessionCaller({
        console_session_id: consoleSessionId,
        lease_id: null,
        ship_id: shipId,
        fleet_id: fleetId,
        kind: 'viewer',
        scopes: ['fleet:read'],
        expires_at: expiresAt,
      }),
    ).toEqual({ caller: { shipId, fleetId, kind: 'viewer', scopes: ['fleet:read'], consoleSessionId }, expiresAt });
  });
});

describe('a row the domain cannot trust', () => {
  it.each([
    ['an id of another kind', { ...shipRow, id: fleetId }],
    ['a malformed fleet id', { ...shipRow, fleetId: 'flt_nope' }],
    ['an unknown kind', { ...shipRow, kind: 'admiral' }],
    ['an unknown scope', { ...shipRow, scopes: ['fleet:sink'] }],
  ])('fails loudly on a ship with %s', (_label, row) => {
    expect(() => toShip(row)).toThrow();
  });

  it('fails loudly on a caller whose ship id is not a ship id', () => {
    expect(() => toAuthenticatedShip({ ship_id: 'shp_nope', fleet_id: fleetId, kind: 'agent', scopes: [] })).toThrow(
      /must be a ship id/,
    );
  });
});
