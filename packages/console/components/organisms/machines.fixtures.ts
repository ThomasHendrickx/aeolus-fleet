import { idSchema, type ListedShip } from '@aeolus-fleet/common';

import type { Spot } from '../../lib/machines';
import type { JoinedMachine, Machine } from '../../lib/trierarch-plugin';
import { minutesAgo, NOW } from './ship-page.fixtures';

/** Example machines for the Trierarchs stories: trierarch-mac alive, trierarch-macbook silent, trierarch-new joined. */

export { NOW };

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`);

const DETAILS: NonNullable<Machine['details']> = {
  harnesses: [
    {
      harness: 'claude-code',
      options: {
        type: 'object',
        properties: { model: { enum: ['claude-opus-5-5', 'claude-sonnet-5'], default: 'claude-opus-5-5' }, effort: { enum: ['low', 'medium', 'high'], default: 'medium' } },
        additionalProperties: false,
      },
      flags: ['--remote-control', '--dangerously-skip-permissions'],
    },
    { harness: 'codex', options: { type: 'object', properties: { model: { enum: ['gpt-6-sol', 'gpt-6'], default: 'gpt-6-sol' } }, additionalProperties: false }, flags: ['--search'] },
  ],
  workspaces: { repositories: ['aeolus-fleet', 'hemma'], folders: ['website', 'notes'] },
  caps: { ships: 6, running: 4 },
  kept: [{ shipId: shipId('pn01'), path: '/home/thomas/.aeolus/trierarch/worktrees/planner-1' }],
  orphans: [{ path: '/home/thomas/.aeolus/trierarch/worktrees/spike-auth' }],
  version: '0.19.0',
};

export const ALIVE_MACHINE: Machine = {
  shipId: shipId('trmc'),
  name: 'trierarch-mac',
  status: 'crewed',
  lastSeenAt: new Date(NOW.getTime() - 8_000).toISOString(),
  isSilent: false,
  report: { state: 'working', note: null, reportedAt: new Date(NOW.getTime() - 12_000).toISOString() },
  details: DETAILS,
};

export const SILENT_MACHINE: Machine = {
  shipId: shipId('trmb'),
  name: 'trierarch-macbook',
  status: 'crewed',
  lastSeenAt: minutesAgo(172),
  isSilent: true,
  report: { state: 'working', note: null, reportedAt: minutesAgo(172) },
  details: { ...DETAILS, harnesses: DETAILS.harnesses.slice(0, 1), kept: [], orphans: [], caps: { ships: 3, running: 2 } },
};

export const NEW_MACHINE: Machine = { shipId: shipId('trnw'), name: 'trierarch-new', status: 'awaitingCrew', lastSeenAt: null, isSilent: false, report: null, details: null };

export const MACHINES: Machine[] = [ALIVE_MACHINE, SILENT_MACHINE, NEW_MACHINE];

export const SPOTS: Spot[] = [
  { shipId: shipId('sp01'), name: 'aeolus-fleet', status: 'running' },
  { shipId: shipId('sp02'), name: 'website-editor', status: 'running' },
  { shipId: shipId('sp03'), name: 'docs-writer', status: 'crashed' },
  { shipId: shipId('sp04'), name: 'scout-1', status: 'crewing' },
];

/** The fleet as the list reads it: the trierarchs' ships, with where they run, and ships assigned to trierarch-mac. */
export const FLEET: ListedShip[] = [
  ...MACHINES.map(
    (machine): ListedShip => ({
      id: machine.shipId, name: machine.name, type: 'trierarch', kind: 'agent', status: machine.status, startingPrompt: null,
      location: machine === NEW_MACHINE ? null : { kind: 'DEVICE', description: machine === ALIVE_MACHINE ? 'Mac mini' : 'MacBook' },
      lastSeenAt: machine.lastSeenAt, ping: null, scopes: ['messages:send', 'messages:receive', 'crew:run'], report: null, harness: null, model: null,
      awaitingCrewSince: null, crewRequest: null, retiredAt: null,
    }),
  ),
  ...SPOTS.map(
    (spot): ListedShip => ({
      id: spot.shipId, name: spot.name, type: 'implementer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
      scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, retiredAt: null,
      crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(90), assignedTo: { id: ALIVE_MACHINE.shipId, name: ALIVE_MACHINE.name }, status: spot.status, reason: null, crewedBy: null },
    }),
  ),
];

export const JOINED: JoinedMachine = {
  shipId: NEW_MACHINE.shipId,
  name: NEW_MACHINE.name,
  prompt: 'You crew the Aeolus ship trierarch-new. Register with the fleet at https://fleet.example.com ...',
  crewLines: [{ harness: 'claude-code', line: '/aeolus:crew https://fleet.example.com shp_01j9k2t4qzr3a9w6m2v5n7trnw aeolus_sk_v1_example' }],
  setupLine: 'npx @aeolus-fleet/trierarch init --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --secret aeolus_sk_v1_example',
};
