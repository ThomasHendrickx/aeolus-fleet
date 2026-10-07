import { idSchema, type ListedShip } from '@aeolus-fleet/common';

import { offersOf } from '../../lib/crew-settings-form';
import { labelContextOf } from '../../lib/labels';
import { machineLabelsInputOf } from '../../lib/machine-labels';
import type { Spot } from '../../lib/machines';
import type { JoinedMachine, Machine } from '../../lib/trierarch-plugin';
import { ARCH, carried, LABELS, labelledFleet, OS } from './labels.fixtures';
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
      riskyFlags: ['--dangerously-skip-permissions'],
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
  { shipId: shipId('sp01'), name: 'aeolus-fleet', status: 'running', attempt: 0, startedAt: minutesAgo(172), workspace: { name: 'aeolus-fleet', kind: 'worktree' } },
  { shipId: shipId('sp02'), name: 'website-editor', status: 'running', attempt: 1, startedAt: minutesAgo(41), workspace: { name: 'website', kind: 'folder' } },
  { shipId: shipId('sp03'), name: 'docs-writer', status: 'crashed', attempt: 5, startedAt: null, workspace: { name: 'notes', kind: 'worktree' } },
  { shipId: shipId('sp04'), name: 'scout-1', status: 'crewing', attempt: 0, startedAt: null },
];

/** The fleet as the list reads it: the trierarchs' ships, with where they run, and ships assigned to trierarch-mac. */
export const FLEET: ListedShip[] = [
  ...MACHINES.map(
    (machine): ListedShip => ({
      id: machine.shipId, name: machine.name, type: 'trierarch', kind: 'agent', status: machine.status, startingPrompt: null,
      location: machine === NEW_MACHINE ? null : { kind: 'DEVICE', description: machine === ALIVE_MACHINE ? 'Mac mini' : 'MacBook' },
      lastSeenAt: machine.lastSeenAt, ping: null, scopes: ['messages:send', 'messages:receive', 'crew:run'], labels: [], report: null, harness: null, model: null,
      awaitingCrewSince: null, crewRequest: null, retiredAt: null,
    }),
  ),
  ...SPOTS.map(
    (spot): ListedShip => ({
      id: spot.shipId, name: spot.name, type: 'implementer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
      scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, retiredAt: null,
      crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(90), assignedTo: { id: ALIVE_MACHINE.shipId, name: ALIVE_MACHINE.name }, status: spot.status, reason: null, crewedBy: null, attempt: spot.attempt, startedAt: spot.startedAt },
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

/** What the answering machines offer, for the Request crew stories. */
export const OFFERS = offersOf(MACHINES);

/** Crew settings as the plugin's form makes them. */
export const SETTINGS = { harness: 'claude-code', workspace: { kind: 'worktree' as const, repository: 'aeolus-fleet' }, options: { model: 'claude-opus-5-5', effort: 'high' }, firstPrompt: 'Triage new GitHub issues on aeolus-fleet and send argo a summary each morning.' };

/** A plain agent ship awaiting crew, for the Needs crew stories. */
const AWAITING: ListedShip = {
  id: shipId('nc00'), name: 'awaiting', type: 'implementer', kind: 'agent', status: 'awaitingCrew', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
  scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null,
};

const TRIAGE: ListedShip = {
  ...AWAITING,
  id: shipId('nc01'), name: 'triage-bot', type: 'triage',
  crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(190), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null },
};

/** Ships on Needs crew: without the plugin, to crew by hand; with it, requests that are not running. */
export const NEEDS_CREW_BY_HAND: ListedShip[] = [
  TRIAGE,
  {
    ...AWAITING,
    id: shipId('nc02'), name: 'reviewer-3', type: 'reviewer',
    startingPrompt: { issuedAt: minutesAgo(12), isClaimed: false },
    crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(87), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null },
  },
  {
    ...AWAITING,
    id: shipId('nc03'), name: 'planner-2', type: 'planner',
    startingPrompt: { issuedAt: minutesAgo(3000), isClaimed: true }, awaitingCrewSince: minutesAgo(375),
    crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(3000), assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null },
  },
];

export const NEEDS_CREW_WITH_PLUGIN: ListedShip[] = [
  { ...TRIAGE, crewRequest: { settingsVersion: 1, requestedAt: minutesAgo(1), assignedTo: null, status: null, reason: 'no trierarch with room: all 2 that fit are full', crewedBy: null, attempt: 0, startedAt: null } },
  ...SPOTS.filter((spot) => spot.status !== 'running').map((spot) => FLEET.find((ship) => ship.id === spot.shipId)).filter((ship) => ship !== undefined),
];

/** The labels the trierarch plugin put on each machine: trierarch-mac and trierarch-macbook run macOS on arm64; trierarch-new has not reported. */
export const MACHINE_CARRIED: Readonly<Record<string, ListedShip['labels']>> = {
  [ALIVE_MACHINE.shipId]: [carried(OS, 'macos'), carried(ARCH, 'arm64')],
  [SILENT_MACHINE.shipId]: [carried(OS, 'macos'), carried(ARCH, 'arm64')],
};

/** The fleet's labels and machines as the Request crew form reads them. */
export const MACHINE_LABELS = machineLabelsInputOf(
  labelContextOf([...LABELS, ARCH], {
    ships: [...labelledFleet().slice(0, 3), ...FLEET.map((ship) => ({ ...ship, labels: MACHINE_CARRIED[ship.id] ?? ship.labels }))],
    isOperator: true,
  }),
  MACHINES,
);

/** The value ids of os=macos and arch=arm64, which two machines carry, and os=linux, which none does. */
export const MACHINE_VALUES = { macos: carried(OS, 'macos').valueId, arm64: carried(ARCH, 'arm64').valueId, linux: carried(OS, 'linux').valueId };
