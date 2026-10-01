import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Caller, Crew } from '../../src/core/shared/caller.js';
import type { Selector } from '../../src/core/shared/selector.js';
import {
  crewAboard,
  historyUseCases,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from './core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from './in-memory.js';
import { unwrap } from './result.js';

/**
 * A fleet for the history reads: argo, scout and lookout of type reviewer and
 * planner of type planner, each crewed, a minute after commissioning.
 */
export interface HistoryScenario {
  core: InMemoryCore;
  fleetId: FleetId;
  argo: Caller;
  scout: Crew;
  lookout: Crew;
  planner: Crew;
  history: ReturnType<typeof historyUseCases>;
  registry: ReturnType<typeof registryUseCases>;
  messaging: ReturnType<typeof messagingUseCases>;
  send(from: Caller, message: { to: Selector; payload?: string; inReplyTo?: MessageId }): Promise<MessageId>;
  /** The crew's receive, as many as it gets in one call; returns the message ids. */
  receive(crew: Crew): Promise<MessageId[]>;
  ack(crew: Crew, messageId: MessageId): Promise<void>;
}

export async function historyScenario(): Promise<HistoryScenario> {
  const core = createInMemoryCore('2026-10-01T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const { fleetId } = fleet;
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  const commission = async (name: string, type: string): Promise<ShipId> =>
    unwrap(await registry.commissionShip(argo, { name, type })).shipId;
  const scout = crewAboard(core, { fleetId, shipId: await commission('scout', 'reviewer') });
  const lookout = crewAboard(core, { fleetId, shipId: await commission('lookout', 'reviewer') });
  const planner = crewAboard(core, { fleetId, shipId: await commission('planner', 'planner') });
  core.clock.advance(60_000);
  const messaging = messagingUseCases(core);

  return {
    core,
    fleetId,
    argo,
    scout,
    lookout,
    planner,
    history: historyUseCases(core),
    registry,
    messaging,
    send: async (from, { to, ...options }) => {
      core.clock.advance(1_000);
      const { messageId } = unwrap(
        await messaging.sendMessage(from, {
          selector: to,
          payload: options.payload ?? 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/48',
          contentType: 'text/plain',
          idempotencyKey: `key-${core.ids('message')}`,
          ...(options.inReplyTo === undefined ? {} : { inReplyTo: options.inReplyTo }),
        }),
      );
      return messageId;
    },
    receive: async (crew) => {
      core.clock.advance(1_000);
      const { deliveries } = unwrap(await messaging.receiveDeliveries(crew, { max: 10 }));
      return deliveries.map((delivery) => delivery.messageId);
    },
    ack: async (crew, messageId) => {
      core.clock.advance(1_000);
      const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
      if (!delivery) {
        throw new Error(`No delivery of ${messageId}`);
      }
      unwrap(await messaging.acknowledgeDelivery(crew, { deliveryId: delivery.id }));
    },
  };
}
