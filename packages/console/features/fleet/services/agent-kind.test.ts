import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { agentKindOf } from './agent-kind';

const PLUGIN_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9h1a';

function aShip(overrides: Partial<ListedShip>): ListedShip {
  return {
    id: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank9h0a'),
    name: 'builder-web',
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: { kind: 'DEVICE', description: null },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, activity: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ownerShipId: null,
    ...overrides,
  };
}

const noPluginShips: ReadonlySet<string> = new Set();

describe('agentKindOf', () => {
  it('is the console for argo and for the viewer ship', () => {
    expect(agentKindOf(aShip({ name: 'argo', type: 'operator', kind: 'operator' }), noPluginShips)).toBe('console');
    expect(agentKindOf(aShip({ name: 'viewer', type: 'viewer', kind: 'viewer' }), noPluginShips)).toBe('console');
  });

  it('is a plugin for a ship a console plugin runs as, whatever its harness', () => {
    const squadrons = aShip({ id: idSchema('ship').parse(PLUGIN_SHIP_ID), type: 'squadrons', harness: 'aeolus-squadrons' });
    expect(agentKindOf(squadrons, new Set([PLUGIN_SHIP_ID]))).toBe('plugin');
  });

  it('is a trierarch for a ship of type trierarch, whatever its harness', () => {
    expect(agentKindOf(aShip({ type: 'trierarch', harness: 'claude-code' }), noPluginShips)).toBe('trierarch');
  });

  it('is Claude Code or Codex from the harness the crewing session stated', () => {
    expect(agentKindOf(aShip({ harness: 'claude-code' }), noPluginShips)).toBe('claudeCode');
    expect(agentKindOf(aShip({ harness: 'codex' }), noPluginShips)).toBe('codex');
  });

  it('is other for a chat harness, an unknown one, and a ship no session crews', () => {
    expect(agentKindOf(aShip({ harness: 'claude-chat' }), noPluginShips)).toBe('other');
    expect(agentKindOf(aShip({ harness: 'a-new-harness' }), noPluginShips)).toBe('other');
    expect(agentKindOf(aShip({ status: 'awaitingCrew', harness: null }), noPluginShips)).toBe('other');
  });
});
