import { createIdGenerator, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { graphNodesOf, graphShipsOf, reachSummaryOf, type GraphShip } from './reach-graph';

const newId = createIdGenerator();

function aListedShip(overrides: Partial<ListedShip>): ListedShip {
  return {
    id: newId('ship'), name: 'scout', type: 'reviewer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: [], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null, ...overrides,
  };
}

function aGraphShip(name: string): GraphShip {
  return { id: newId('ship'), name, isOperator: name === 'argo' };
}

describe('the ships the graph draws', () => {
  it('are argo first, then the other ships by name', () => {
    const ships = [aListedShip({ name: 'vault' }), aListedShip({ name: 'argo', kind: 'operator' }), aListedShip({ name: 'planner' })];

    expect(graphShipsOf(ships).map((ship) => ship.name)).toEqual(['argo', 'planner', 'vault']);
  });

  it('leave retired ships and the viewer ship out', () => {
    const ships = [aListedShip({ name: 'planner' }), aListedShip({ name: 'old', status: 'retired' }), aListedShip({ name: 'viewer', kind: 'viewer' })];

    expect(graphShipsOf(ships).map((ship) => ship.name)).toEqual(['planner']);
  });
});

describe('the graph nodes', () => {
  const argo = aGraphShip('argo');
  const planner = aGraphShip('planner');
  const scout = aGraphShip('scout');
  const vault = aGraphShip('vault');
  const ships = [argo, planner, scout, vault];

  it('place the ships evenly on a circle, the first at the top', () => {
    expect(graphNodesOf(ships, undefined).map(({ x, y }) => [x, y])).toEqual([
      [50, 12],
      [88, 50],
      [50, 88],
      [12, 50],
    ]);
  });

  it('place a lone ship in the middle', () => {
    expect(graphNodesOf([argo], undefined).map(({ x, y }) => [x, y])).toEqual([[50, 50]]);
  });

  it('mark no ship while none is picked', () => {
    expect(graphNodesOf(ships, undefined).map((node) => node.mark)).toEqual(['none', 'none', 'none', 'none']);
  });

  it('mark the picked ship, the ships it reaches and the ships out of its reach', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: [argo.id, planner.id] });

    expect(nodes.map((node) => node.mark)).toEqual(['reached', 'reached', 'picked', 'unreached']);
  });

  it('mark only the picked ship while its reach is not known yet', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: undefined });

    expect(nodes.map((node) => node.mark)).toEqual(['none', 'none', 'picked', 'none']);
  });
});

describe('the reach summary', () => {
  const argo = aGraphShip('argo');
  const planner = aGraphShip('planner');
  const scout = aGraphShip('scout');
  const vault = aGraphShip('vault');
  const ships = [argo, planner, scout, vault];

  it('asks to pick a ship while none is picked', () => {
    expect(reachSummaryOf(graphNodesOf(ships, undefined))).toBe('Pick a ship to see which ships it may message.');
  });

  it('names the ships the picked ship reaches, out of the others', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: [argo.id, planner.id] });

    expect(reachSummaryOf(nodes)).toBe('scout may message 2 of 3 ships: argo, planner.');
  });

  it('says when the picked ship reaches every other ship', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: [argo.id, planner.id, vault.id] });

    expect(reachSummaryOf(nodes)).toBe('scout may message every other ship (3).');
  });

  it('says when the picked ship reaches no other ship', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: [] });

    expect(reachSummaryOf(nodes)).toBe('scout may message no other ship.');
  });

  it('says it is finding the reach while it is not known yet', () => {
    const nodes = graphNodesOf(ships, { pickedShipId: scout.id, reachableShipIds: undefined });

    expect(reachSummaryOf(nodes)).toBe('Finding the ships scout may message…');
  });

  it('says when the picked ship is the only ship', () => {
    expect(reachSummaryOf(graphNodesOf([argo], { pickedShipId: argo.id, reachableShipIds: [] }))).toBe('argo is the only ship of the fleet.');
  });
});
