import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { isModelMismatch, type Member, type Squadron } from './squadron.js';

const AT = new Date('2026-10-03T09:00:00.000Z');
const REPO = 'example.com/templates';
const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';

function aSquadron(pinned: string | null): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state: 'forming',
    blueprint: {
      repository: REPO,
      name: 'team',
      version: 1,
      commit: 'b1',
      committedAt: AT,
      description: 'A team.',
      roles: [{ name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1 }],
      handoffs: [],
      memberNames: 'plain',
    },
    templates: [
      { repository: REPO, name: 'tester', version: 4, commit: 't4', committedAt: AT, description: 'Tests.', checkInMinutes: 30, model: pinned, launchNote: null, charter: 'You test.', handoffs: [] },
    ],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [],
    formedAt: AT,
    sailedAt: null,
  };
}

function aTester(checkIn: Member['checkIn']): Member {
  return { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn, standDownMessageId: null, stoodDownAt: null, retiredAt: null };
}

describe('a model mismatch', () => {
  it('flags a member that checked in stating another model than its template pins', () => {
    expect(isModelMismatch(aSquadron('claude-opus-5-5'), aTester({ at: AT, model: 'claude-sonnet-5-5' }))).toBe(true);
  });

  it('flags a member that checked in stating no model while its template pins one', () => {
    expect(isModelMismatch(aSquadron('claude-opus-5-5'), aTester({ at: AT, model: null }))).toBe(true);
  });

  it('does not flag a member that states the pinned model', () => {
    expect(isModelMismatch(aSquadron('claude-opus-5-5'), aTester({ at: AT, model: 'claude-opus-5-5' }))).toBe(false);
  });

  it('does not flag a member before it checks in', () => {
    expect(isModelMismatch(aSquadron('claude-opus-5-5'), aTester(null))).toBe(false);
  });

  it('does not flag any model when the template pins none', () => {
    expect(isModelMismatch(aSquadron(null), aTester({ at: AT, model: 'claude-haiku-4-5-20251001' }))).toBe(false);
  });
});
