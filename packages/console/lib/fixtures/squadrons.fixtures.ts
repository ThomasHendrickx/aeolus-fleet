import { idSchema, type ShipDetail } from '@aeolus-fleet/common';

import type { Catalogue, Squadron } from '../squadrons-schemas';
import { AWAITING_SHIP, CREWED_SHIP } from './ship-page.fixtures';

/** Squadrons, blueprints and templates for the stories. */

const REPO = 'github.com/thomashendrickx/squadron-templates';
const AT = '2026-10-03T09:12:00.000Z';

export const templates: Catalogue['templates'] = [
  { repository: REPO, name: 'planner', version: 2, commit: 'p2', committedAt: AT, description: 'Plans.', checkInMinutes: 30, model: null, launchNote: 'Start in the repository root.', charter: '# planner\n\nYou plan one slice. Hand the plan to on-task.', handoffs: [{ name: 'on-task', carries: 'The plan for one slice' }], file: '.aeolus/squadrons/templates/planner.yaml' },
  { repository: REPO, name: 'implementer', version: 3, commit: 'i3', committedAt: AT, description: 'Builds.', checkInMinutes: 15, model: 'claude-opus-5-5', launchNote: null, charter: '# implementer\n\nYou build what the planner hands you. Hand the branch to on-done.', handoffs: [{ name: 'on-done', carries: 'The branch and its PR' }], file: '.aeolus/squadrons/templates/implementer.yaml' },
  { repository: REPO, name: 'tester', version: 4, commit: 't4', committedAt: AT, description: 'Tests.', checkInMinutes: 10, model: null, launchNote: 'Start in a worktree with Docker running.', charter: '# tester\n\nYou test what implementers hand you. You never change product code.\n\n1. Run the e2e suite.\n2. Pass: hand off on-pass. Fail: hand off on-fail with the first error.', handoffs: [{ name: 'on-fail', carries: 'The failing tests and the first error' }, { name: 'on-pass', carries: 'The run that passed' }], file: '.aeolus/squadrons/templates/tester.yaml' },
];

export const blueprints: Catalogue['blueprints'] = [
  {
    repository: REPO,
    name: 'aeolus',
    version: 4,
    commit: 'a4',
    committedAt: AT,
    description: 'Planner, 2 implementers, tester',
    roles: [
      { name: 'planner', template: { repository: REPO, name: 'planner', version: 2 }, count: 1 },
      { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 3 }, count: 2 },
      { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1 },
    ],
    handoffs: [],
    memberNames: 'plain',
    file: '.aeolus/squadrons/blueprints/aeolus.yaml',
  },
  {
    repository: REPO,
    name: 'aeolus',
    version: 3,
    commit: 'a3',
    committedAt: AT,
    description: 'Planner, implementer, tester',
    roles: [{ name: 'planner', template: { repository: REPO, name: 'planner', version: 2 }, count: 1 }],
    handoffs: [],
    memberNames: 'plain',
    file: '.aeolus/squadrons/blueprints/aeolus.yaml',
  },
  { repository: REPO, name: 'docs', version: 1, commit: 'd1', committedAt: AT, description: '2 writers', roles: [], handoffs: [], memberNames: 'plain', file: '.aeolus/squadrons/blueprints/docs.yaml' },
];

const noModel = { pinned: null, stated: null, isMismatch: false };
type MemberFacts = Pick<Squadron['members'][number], 'health' | 'checkInMinutes' | 'crew'>;
const onTime: MemberFacts = { health: 'on-time', checkInMinutes: 30, crew: { status: 'crewed', lastSeenAt: AT, crewedSince: AT } };
const notOnStation: MemberFacts = { health: 'not-on-station', checkInMinutes: 15, crew: { status: 'awaitingCrew', lastSeenAt: null, crewedSince: null } };

export const forming: Squadron = {
  id: 'aeolus-a1b2c3',
  state: 'forming',
  blueprint: { repository: REPO, name: 'aeolus', version: 4, commit: 'a4' },
  flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'aeolus-a1b2c3' },
  members: [
    { ...onTime, shipId: 'shp_01m3tbfspe96yf1rnr4ank0001', name: 'planner-k3x9', role: 'planner', type: 'aeolus-a1b2c3:planner', onStationAt: AT, model: noModel },
    {
      ...notOnStation,
      shipId: 'shp_01m3tbfspe96yf1rnr4ank0002',
      name: 'implementer-m4p7',
      role: 'implementer',
      type: 'aeolus-a1b2c3:implementer',
      onStationAt: null,
      model: { pinned: 'claude-opus-5-5', stated: null, isMismatch: false },
    },
    {
      ...onTime,
      shipId: 'shp_01m3tbfspe96yf1rnr4ank0003',
      name: 'implementer-q8r2',
      role: 'implementer',
      type: 'aeolus-a1b2c3:implementer',
      onStationAt: AT,
      model: { pinned: 'claude-opus-5-5', stated: 'claude-sonnet-5-5', isMismatch: true },
    },
    { ...notOnStation, shipId: 'shp_01m3tbfspe96yf1rnr4ank0004', name: 'tester-w5t1', role: 'tester', type: 'aeolus-a1b2c3:tester', onStationAt: null, model: noModel },
  ],
  formedAt: AT,
  sailedAt: null,
};

export const sailing: Squadron = {
  ...forming,
  id: 'docs-x7q2w9',
  state: 'sailing',
  blueprint: { repository: REPO, name: 'docs', version: 1, commit: 'd1' },
  members: forming.members.map((member) => ({ ...member, ...onTime, onStationAt: AT })),
  sailedAt: AT,
};

/** The crew lines squadrons hands a member: one per plugin harness, each with the squadron id, and one for a chat client. */
function memberCrewLines(shipId: string) {
  const identity = `https://fleet.example.dev ${shipId} aeolus_sk_v1_example aeolus-a1b2c3`;
  return [
    { harness: 'claude-code', line: `/aeolus:crew ${identity}` },
    { harness: 'codex', line: `$aeolus-crew ${identity}` },
    {
      harness: 'chat',
      line: `Crew Aeolus ship ${shipId} through the fleet's MCP connector at https://fleet.example.dev/mcp: register with ship id ${shipId}, secret aeolus_sk_v1_example and your chat client as harness (claude-chat or chatgpt). Then check in: send the ship aeolus-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"aeolus-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"aeolus-a1b2c3","role":"implementer"}, and take up the charter.`,
    },
  ];
}

export const crewLines = new Map([
  ['shp_01m3tbfspe96yf1rnr4ank0002', { crewLines: memberCrewLines('shp_01m3tbfspe96yf1rnr4ank0002'), launchNote: null, model: null }],
  ['shp_01m3tbfspe96yf1rnr4ank0004', { crewLines: memberCrewLines('shp_01m3tbfspe96yf1rnr4ank0004'), launchNote: 'Start in a worktree with Docker running.', model: 'claude-opus-5-5' }],
]);

export { NOW } from './ship-page.fixtures';

/** The members' ships as the fleet has them: on-station members crewed and reporting, the others awaiting crew. */
export const memberShips: ReadonlyMap<string, ShipDetail> = new Map(
  forming.members.map((member) => {
    const id = idSchema('ship').parse(member.shipId);
    const ship: ShipDetail = member.onStationAt === null ? { ...AWAITING_SHIP, id, name: member.name } : { ...CREWED_SHIP, id, name: member.name };
    return [member.shipId, ship];
  }),
);
