import type { IdGenerator } from '@aeolus-fleet/common';

import type { SecretTools } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ShipRepository } from './ports.js';
import { commissionAgentShip, type CommissionRefusal } from './ship.js';
import { issueStartingPrompt, type IssuedStartingPrompt, type StartingPromptTx } from './starting-prompt.js';

export interface CommissionShipTx extends StartingPromptTx {
  ships: ShipRepository;
}

export type CommissionShip = (
  caller: Caller,
  input: { name: string; type: string; note?: string },
) => Promise<Result<IssuedStartingPrompt, CommissionRefusal>>;

/**
 * Use case: the caller commissions an agent ship in its own fleet. The ship
 * awaits crew and gets its first starting prompt, all in one transaction. The
 * caller's scope (fleet:manage) is checked before this runs.
 */
export function createCommissionShip(deps: {
  uow: UnitOfWork<CommissionShipTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
  fleetUrl: string;
}): CommissionShip {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<IssuedStartingPrompt, CommissionRefusal>> => {
      const { fleetId } = caller;
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();

      await tx.ships.lockName(fleetId, input.name);
      const commissioned = commissionAgentShip(
        { ...input, id: deps.ids('ship'), fleetId, at, actor },
        { activeShipNamed: await tx.ships.findActiveByName(fleetId, input.name) },
      );
      if (!commissioned.isOk) {
        return commissioned;
      }
      const { ship, events } = commissioned.value;

      await tx.ships.create(ship);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      const prompt = await issueStartingPrompt(
        { tx, secrets: { ...deps.secrets, ids: deps.ids }, fleetUrl: deps.fleetUrl },
        { fleetId, shipId: ship.id, actor, at },
      );
      return ok({ shipId: ship.id, prompt });
    });
}
