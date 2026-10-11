import { idSchema, type ListedShip } from '@aeolus-fleet/common';

/** Example ships a message can go to, for the stories of SelectorPicker and ComposeDialog. */

function ship(suffix: string, changes: Partial<ListedShip> & Pick<ListedShip, 'name' | 'type'>): ListedShip {
  return {
    id: idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4ank${suffix}`),
    kind: 'agent',
    status: 'crewed',
    startingPrompt: { issuedAt: '2026-09-28T08:30:00.000Z', isClaimed: true },
    location: { kind: 'DEVICE', description: null },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null,
    ...changes,
  };
}

export const REVIEWER_01 = ship('r01a', {
  name: 'reviewer-01',
  type: 'reviewer',
  location: { kind: 'SERVER', description: 'hetzner-1' },
  lastSeenAt: null,
  ping: null,
  scopes: ['messages:send', 'messages:receive'],
  report: null,
});

export const COMPOSE_SHIPS: ListedShip[] = [
  REVIEWER_01,
  ship('r02a', { name: 'reviewer-02', type: 'reviewer' }),
  ship('b01a', { name: 'builder-core', type: 'builder', status: 'awaitingCrew', location: null }),
  ship('t01a', { name: 'tester-01', type: 'tester' }),
];

export const COMPOSE_TYPES = ['builder', 'reviewer', 'tester'];
