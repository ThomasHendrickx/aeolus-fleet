import { createIdGenerator, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { allowedPaletteItems, paletteGroups, paletteItemsOf, paletteKeyOf, SHIPS_BEFORE_QUERY, type PaletteItem } from './command-palette';

const newId = createIdGenerator();

const compose: PaletteItem = { kind: 'action', id: 'compose', label: 'Compose message' };
const commission: PaletteItem = { kind: 'action', id: 'commission', label: 'Commission ship' };
const overview: PaletteItem = { kind: 'page', id: 'overview', label: 'Fleet overview', href: '/' };
const inbox: PaletteItem = { kind: 'page', id: 'inbox', label: 'Operator inbox', href: '/inbox' };

function aShip(name: string, type: string): PaletteItem {
  const id = newId('ship');
  return { kind: 'ship', id, name, type, status: 'crewed', href: `/ships/${id}` };
}

const reviewer = aShip('reviewer-01', 'reviewer');
const tester = aShip('tester-01', 'tester');
const items = [compose, commission, reviewer, tester, overview, inbox];

function labels(query: string) {
  return paletteGroups(items, query).map((group) => [group.label, group.items.map(paletteKeyOf)]);
}

describe('paletteGroups', () => {
  it('shows every group in order with no query: Actions, Ships, Go to', () => {
    expect(paletteGroups(items, '').map((group) => group.label)).toEqual(['Actions', 'Ships', 'Go to']);
  });

  it('finds a ship by its name or its type, in any case', () => {
    expect(labels('REVI')).toEqual([['Ships', [paletteKeyOf(reviewer)]]]);
    expect(labels('tester')).toEqual([['Ships', [paletteKeyOf(tester)]]]);
  });

  it('finds actions and pages by their label, and leaves out groups with no match', () => {
    expect(labels('inbox')).toEqual([['Go to', [paletteKeyOf(inbox)]]]);
    expect(labels('ship')).toEqual([['Actions', [paletteKeyOf(commission)]]]);
  });

  it('shows nothing when nothing matches', () => {
    expect(paletteGroups(items, 'deploy')).toEqual([]);
  });

  it('caps the ships before the operator types, and lists every match after', () => {
    const many = Array.from({ length: SHIPS_BEFORE_QUERY + 2 }, (_, index) => aShip(`ship-${String(index)}`, 'reviewer'));

    expect(paletteGroups(many, '')[0]?.items).toHaveLength(SHIPS_BEFORE_QUERY);
    expect(paletteGroups(many, 'ship')[0]?.items).toHaveLength(SHIPS_BEFORE_QUERY + 2);
  });

  it('ignores spaces around the query', () => {
    expect(labels('  revi ')).toEqual([['Ships', [paletteKeyOf(reviewer)]]]);
  });
});

describe('paletteItemsOf', () => {
  it('offers the actions, the active agent ships, never argo or a retired ship, and the pages', () => {
    const ships: ListedShip[] = [
      { id: newId('ship'), name: 'argo', type: 'operator', kind: 'operator', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null, scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: {}, retiredAt: null },
      { id: newId('ship'), name: 'reviewer-01', type: 'reviewer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null, scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: {}, retiredAt: null },
      { id: newId('ship'), name: 'old', type: 'reviewer', kind: 'agent', status: 'retired', startingPrompt: null, location: null, lastSeenAt: null, ping: null, scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: {}, retiredAt: null },
    ];

    expect(paletteItemsOf(ships).map((item) => (item.kind === 'ship' ? item.name : item.id))).toEqual([
      'commission',
      'compose',
      'reviewer-01',
      'overview',
      'inbox',
      'attention',
    ]);
  });

  it('adds, with squadrons on, Form squadron, the squadrons not disbanded, the blueprints and the Squadrons page', () => {
    const blueprint = { repository: 'example.com/t', name: 'team', version: 2, commit: 'c', committedAt: '2026-10-01T09:00:00.000Z', description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' as const, file: 'squadrons/blueprints/team.yaml' };
    const items = paletteItemsOf([], {
      squadrons: [
        { id: 'team-a1b2c3', state: 'sailing', blueprint: { repository: 'example.com/t', name: 'team', version: 2, commit: 'c' } },
        { id: 'team-old', state: 'disbanded', blueprint: { repository: 'example.com/t', name: 'team', version: 1, commit: 'b' } },
      ],
      blueprints: [{ key: 'example.com/t#team', repository: 'example.com/t', name: 'team', versions: [blueprint] }],
    });

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'action:commission',
      'action:form-squadron',
      'action:compose',
      'squadron:team-a1b2c3',
      'squadron-action:add-member:team-a1b2c3',
      'squadron-action:stand-down:team-a1b2c3',
      'blueprint:example.com/t#team',
      'page:overview',
      'page:squadrons',
      'page:inbox',
      'page:attention',
    ]);
  });

  it('finds a squadron by its blueprint, in its own group', () => {
    const items = paletteItemsOf([], {
      squadrons: [{ id: 'team-a1b2c3', state: 'forming', blueprint: { repository: 'r', name: 'hemma', version: 1, commit: 'c' } }],
      blueprints: [],
    });

    expect(paletteGroups(items, 'hemma').map((group) => [group.key, group.items.length])).toEqual([['squadrons', 1]]);
  });
});

describe("a squadron's actions in the palette", () => {
  const items = paletteItemsOf([], {
    squadrons: [
      { id: 'aeolus-a1b2c3', state: 'sailing', blueprint: { repository: 'r', name: 'aeolus', version: 3, commit: 'c' } },
      { id: 'hemma-k9m4p2', state: 'forming', blueprint: { repository: 'r', name: 'hemma', version: 2, commit: 'c' } },
    ],
    blueprints: [],
  });

  it('offers Add member and Stand down for a Sailing squadron the query finds, among the actions', () => {
    const actions = paletteGroups(items, 'aeolus').find((group) => group.key === 'actions');

    expect(actions?.items.map((item) => (item.kind === 'squadron-action' ? [item.label, item.href] : undefined))).toEqual([
      ['Add member to aeolus-a1b2c3…', '/squadrons/aeolus-a1b2c3?action=add-member'],
      ['Stand down aeolus-a1b2c3…', '/squadrons/aeolus-a1b2c3?action=stand-down'],
    ]);
  });

  it('offers none before the operator types', () => {
    expect(paletteGroups(items, '').flatMap((group) => group.items).some((item) => item.kind === 'squadron-action')).toBe(false);
  });

  it('offers none for a squadron that is not Sailing', () => {
    expect(paletteGroups(items, 'hemma').find((group) => group.key === 'actions')).toBeUndefined();
  });

  it('offers none to a session that may not manage the fleet', () => {
    expect(allowedPaletteItems(items, { canManage: false, canSend: true }).some((item) => item.kind === 'squadron-action')).toBe(false);
  });
});

describe('the palette of a console session', () => {
  const items = paletteItemsOf([], { squadrons: [], blueprints: [] });

  it('offers the operator every action', () => {
    expect(allowedPaletteItems(items, { canManage: true, canSend: true }).filter((item) => item.kind === 'action').map((item) => item.id)).toEqual(['commission', 'form-squadron', 'compose']);
  });

  it('offers a viewer no action, and every page', () => {
    const allowed = allowedPaletteItems(items, { canManage: false, canSend: false });

    expect(allowed.filter((item) => item.kind === 'action')).toEqual([]);
    expect(allowed.filter((item) => item.kind === 'page').map((item) => item.id)).toEqual(['overview', 'squadrons', 'inbox', 'attention']);
  });

  it('offers Compose to a session that sends but does not manage', () => {
    expect(allowedPaletteItems(items, { canManage: false, canSend: true }).filter((item) => item.kind === 'action').map((item) => item.id)).toEqual(['compose']);
  });
});
