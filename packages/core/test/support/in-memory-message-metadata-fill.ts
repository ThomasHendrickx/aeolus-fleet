/**
 * The metadata fill's ports over a small in-memory state: per fleet, the
 * messages by id and the exchanges by key the migrations left unfilled, the
 * ones a batch filled, and its cursor. One unit of work at a time; a unit of
 * work that throws leaves the state as it was. A test makes a fleet's next
 * batch fail as it saves its cursor, or the indexes' build.
 */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import type { Fleet } from '../../src/domain/registry/fleet.js';
import type { ExchangeKey, MessageMetadataFill, MetadataFillCursor, MetadataFillIndexes } from '../../src/domain/messaging/ports.js';
import type { UnitOfWork } from '../../src/domain/shared/unit-of-work.js';

interface FleetFill {
  messageIds: MessageId[];
  exchanges: ExchangeKey[];
  filledMessageIds: MessageId[];
  filledExchanges: ExchangeKey[];
  cursor: MetadataFillCursor | undefined;
}

export interface InMemoryMetadataFill {
  uow: UnitOfWork<{ messageMetadataFill: MessageMetadataFill }>;
  indexes: MetadataFillIndexes;
  fleets: { list(): Promise<Fleet[]> };
  /** What ran, in order: `indexes` for a build, the fleet id for each batch. */
  ran: string[];
  stored(fleetId: FleetId): { messageIds: MessageId[]; exchanges: ExchangeKey[] };
  filled(fleetId: FleetId): { messageIds: MessageId[]; exchanges: ExchangeKey[] };
  cursorOf(fleetId: FleetId): MetadataFillCursor | undefined;
  failNextBatchOf(fleetId: FleetId): void;
  failNextBuild(): void;
}

function keyText({ shipId, otherShipId }: ExchangeKey): string {
  return `${shipId} ${otherShipId}`;
}

function byKey(first: ExchangeKey, second: ExchangeKey): number {
  return first.shipId.localeCompare(second.shipId) || first.otherShipId.localeCompare(second.otherShipId);
}

/** A fleet's unfilled history: `messages` messages and `exchanges` exchanges, ids and keys in their Postgres order. */
export function createInMemoryMetadataFill(history: { fleetId: FleetId; messages: number; exchanges: number }[]): InMemoryMetadataFill {
  const state = new Map<FleetId, FleetFill>(
    history.map(({ fleetId, messages, exchanges }) => [
      fleetId,
      {
        messageIds: Array.from({ length: messages }, (_, i): MessageId => `msg_${String(i + 1).padStart(26, '0')}`),
        exchanges: Array.from({ length: exchanges }, (_, i): ExchangeKey => ({ shipId: `shp_${String(i + 1).padStart(26, '0')}`, otherShipId: `shp_${'9'.repeat(26)}` })).toSorted(byKey),
        filledMessageIds: [],
        filledExchanges: [],
        cursor: undefined,
      },
    ]),
  );
  const ran: string[] = [];
  const failingFleets = new Set<FleetId>();
  let isBuildFailing = false;

  const fleetOf = (fleetId: FleetId): FleetFill => {
    const fill = state.get(fleetId) ?? { messageIds: [], exchanges: [], filledMessageIds: [], filledExchanges: [], cursor: undefined };
    state.set(fleetId, fill);
    return fill;
  };

  const messageMetadataFill: MessageMetadataFill = {
    lockCursor: (fleetId) => {
      ran.push(fleetId);
      return Promise.resolve(structuredClone(fleetOf(fleetId).cursor ?? { afterMessageId: null, afterExchange: null, isComplete: false }));
    },
    fillQuestionIds: (fleetId, { after, limit }) => {
      const fill = fleetOf(fleetId);
      const visited = fill.messageIds.filter((id) => after === null || id > after).slice(0, limit);
      fill.filledMessageIds.push(...visited.filter((id) => !fill.filledMessageIds.includes(id)));
      return Promise.resolve(visited);
    },
    fillUnseenPlainMessages: (fleetId, { after, limit }) => {
      const fill = fleetOf(fleetId);
      const visited = fill.exchanges.filter((key) => after === null || byKey(key, after) > 0).slice(0, limit);
      const filled = new Set(fill.filledExchanges.map(keyText));
      fill.filledExchanges.push(...visited.filter((key) => !filled.has(keyText(key))));
      return Promise.resolve(visited);
    },
    saveCursor: (fleetId, cursor) => {
      if (failingFleets.delete(fleetId)) {
        return Promise.reject(new Error(`the batch of ${fleetId} failed`));
      }
      fleetOf(fleetId).cursor = structuredClone(cursor);
      return Promise.resolve();
    },
  };

  let queue: Promise<unknown> = Promise.resolve();
  const uow: InMemoryMetadataFill['uow'] = {
    run: (work) => {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          const result = await work({ messageMetadataFill });
          if (!result.isOk) {
            restore(snapshot);
          }
          return result;
        } catch (error) {
          restore(snapshot);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  const restore = (snapshot: Map<FleetId, FleetFill>) => {
    state.clear();
    for (const [fleetId, fill] of snapshot) {
      state.set(fleetId, fill);
    }
  };

  return {
    uow,
    indexes: {
      build: () => {
        ran.push('indexes');
        if (isBuildFailing) {
          isBuildFailing = false;
          return Promise.reject(new Error('the index build failed'));
        }
        return Promise.resolve();
      },
    },
    fleets: { list: () => Promise.resolve([...state.keys()].map((id) => ({ id, name: id, createdAt: new Date(0) }))) },
    ran,
    stored: (fleetId) => ({ messageIds: [...fleetOf(fleetId).messageIds], exchanges: [...fleetOf(fleetId).exchanges] }),
    filled: (fleetId) => ({ messageIds: [...fleetOf(fleetId).filledMessageIds], exchanges: [...fleetOf(fleetId).filledExchanges].toSorted(byKey) }),
    cursorOf: (fleetId) => structuredClone(fleetOf(fleetId).cursor),
    failNextBatchOf: (fleetId) => {
      failingFleets.add(fleetId);
    },
    failNextBuild: () => {
      isBuildFailing = true;
    },
  };
}
