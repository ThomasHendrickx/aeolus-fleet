import { beforeEach, describe } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { meetingListScenarios, type MeetingListHarness } from '../../../test/support/meeting-list-scenarios.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { ok } from '../shared/result.js';
import { createListMeetings } from './list-meetings.js';

let harness: MeetingListHarness;
beforeEach(async () => {
  const core = createInMemoryCore();
  const fleet = await initialiseFleet(core);
  const commission = async (name: string) => unwrap(await registryUseCases(core).commissionShip(operatorCaller(fleet), { name, type: 'agent', idempotencyKey: newKey() })).shipId;
  const shipId = await commission('reader');
  const crew = crewAboard(core, { fleetId: fleet.fleetId, shipId });
  const list = createListMeetings({ uow: core.uow });
  harness = {
    fleetId: fleet.fleetId, shipId, ownerId: await commission('owner'), moderatorId: await commission('moderator'), otherId: await commission('other'),
    add: async (meeting) => { unwrap(await core.uow.run(async (tx) => { await tx.meetings.create(meeting); return ok(undefined); })); },
    contribute: async (meeting, at) => { unwrap(await core.uow.run(async (tx) => { await tx.meetings.contributed(meeting.fleetId, { meetingId: meeting.id, at }); return ok(undefined); })); },
    removeOwner: async () => {
      const owner = core.state.ships.find((ship) => ship.id === harness.ownerId);
      if (owner) { owner.retiredAt = new Date('2026-11-21T11:00:00.000Z'); owner.removedAt = new Date('2026-11-21T12:00:00.000Z'); }
    },
    list: (input) => list(crew, input),
  };
});

describe('a ship lists its meetings through in-memory ports', () => meetingListScenarios(() => harness));
