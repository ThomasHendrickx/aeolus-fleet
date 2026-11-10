/** Direct destinations are permission-filtered by the database before a 20-row page. */
import type { DiscoveryPageOutput, PersonShipPageInput } from '@aeolus-fleet/common';

import type { Crew } from '../shared/caller.js';
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { personShipPageOf, personShipPagePosition } from './person-ship-page.js';
import { personShipSendPermission } from './person-ship-permissions.js';
import type { PersonReadUnitOfWork } from './person-read-unit-of-work.js';
import type { PersonShipReadRefusal, PersonShipReadTx } from './person-ship-reads.js';

export type DiscoveryPage = (caller: Crew, input: PersonShipPageInput) => Promise<Result<DiscoveryPageOutput, PersonShipReadRefusal>>;

export function createDiscoveryPage(deps: { uow: PersonReadUnitOfWork<PersonShipReadTx> }): DiscoveryPage {
  return async (caller, input) => {
    const position = personShipPagePosition(caller, { input, section: 'discovery' });
    if (!position.isOk) {
      return position;
    }
    return deps.uow.run(caller.fleetId, async (tx): Promise<Result<DiscoveryPageOutput, PersonShipReadRefusal>> => {
      const facts = await tx.facts.find(caller, { verbs: ['send'] });
      if (!facts.isCrewActive || facts.sender === null) {
        return refuse('LEASE_ENDED', 'The ship no longer has an active crew');
      }
      const sender = personShipSendPermission(facts);
      if (sender === null) {
        return refuse('SCOPE_NOT_HELD', 'This call needs the messages:send scope');
      }
      const rows = await tx.projection.page(caller.fleetId, { ...position.value, policy: { section: 'discovery', sender } });
      const page = personShipPageOf(position.value, rows);
      return ok({ rows: page.selected.map(({ row }) => row), nextCursor: page.nextCursor });
    });
  };
}
