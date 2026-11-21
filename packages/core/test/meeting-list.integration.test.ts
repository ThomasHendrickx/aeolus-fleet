/** The approved list scenarios on the real Postgres adapter. */
import { afterEach, beforeEach, describe } from 'vitest';

import { createPrismaMeetingRepository } from '../src/adapters/prisma/meetings.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createListMeetings } from '../src/domain/messaging/list-meetings.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { agentCaller, operatorCaller } from './support/core-fixtures.js';
import { meetingListScenarios, type MeetingListHarness } from './support/meeting-list-scenarios.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

let core: PostgresCore;
let harness: MeetingListHarness;
beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'meeting-list fleet' })));
  const commission = async (name: string) => unwrap(await core.useCases.commissionShip(operatorCaller(fleet), { name, type: 'agent', idempotencyKey: newKey() })).shipId;
  const shipId = await commission('reader');
  const repository = createPrismaMeetingRepository(core.prisma);
  const list = createListMeetings({ uow: createPrismaUnitOfWork(core.prisma) });
  const caller = agentCaller({ fleetId: fleet.fleetId, shipId });
  harness = {
    fleetId: fleet.fleetId, shipId, ownerId: await commission('owner'), moderatorId: await commission('moderator'), otherId: await commission('other'),
    add: (meeting) => repository.create(meeting),
    contribute: (meeting, at) => repository.contributed(meeting.fleetId, { meetingId: meeting.id, at }),
    removeOwner: async () => {
      await core.prisma.ship.update({ where: { fleetId_id: { fleetId: harness.fleetId, id: harness.ownerId } }, data: { retiredAt: new Date('2026-11-21T11:00:00.000Z'), removedAt: new Date('2026-11-21T12:00:00.000Z'), scopes: [], ownerShipId: null } });
    },
    list: (input) => list(caller, input),
  };
});
afterEach(async () => { await core?.close(); });

describe('a ship lists its meetings through Postgres', () => meetingListScenarios(() => harness));
