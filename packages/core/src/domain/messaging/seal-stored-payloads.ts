import { payloadBytes, type FleetId, type IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import type { DataKey } from './payload-sealer.js';
import type { FleetSealingRepository, RequestHasher, SealedPayloads, SealedRowPayload, SealingCursor } from './ports.js';
import type { Message } from './message.js';
import type { Schedule } from './schedule.js';
import { sendRequestText } from './send-request.js';

/** How many messages, and how many schedules, one batch seals at most: each batch stays one short transaction. */
export const SEALING_BATCH = 200;
/** How long one fleet's pass seals before it leaves the rest to the next pass, so the 30 second pass goes on. */
export const SEALING_BUDGET_MS = 10_000;

export interface SealStoredPayloadsTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

/** Seals every sealing fleet's plain payloads; `onFleetError` (the pass always gives it) is told of a fleet whose pass threw, and the pass goes on with the next fleet. */
export type SealStoredPayloads = (onFleetError?: (fleetId: FleetId, error: unknown) => void) => Promise<void>;

/** What one batch did: more may be left after its cursor, or none is; or the fleet's sealing is another server's now. */
type Batch = { kind: 'more'; after: SealingCursor | null } | { kind: 'done' } | { kind: 'skipped' };

/**
 * Use case: the sealing pass (decision 0068, B5), run by core in the 30
 * second pass, never through the API. A fleet that turned sealing on with
 * payloads stored plain reads sealing; the pass seals them in batches, each
 * one unit of work under the fleet's sealing lock taken with try: it reads
 * the plain messages after its cursor and the plain schedules, skipping rows
 * another unit of work holds, and stores each sealed for its own row under
 * the current data key, its plain byte count kept, and its request hash
 * made again without the payload (B10), from what the row holds: the
 * selector as resolved, the content type and what it answers, so a copy
 * confirms no guessed payload. The data key is unwrapped
 * outside the unit of work; with the company key cut off the pass waits and
 * seals nothing (B12). Once a batch finds none left, one unit of work holds
 * the fleet and finds none stored plain: the fleet reads sealed and
 * FleetPayloadsSealed is written; a row skipped or committed meanwhile
 * leaves it sealing for the next pass. A pass whose time budget is spent
 * leaves the rest to the next one.
 */
export function createSealStoredPayloads(deps: {
  sealings: Pick<FleetSealingRepository, 'sealingFleetIds'>;
  uow: UnitOfWork<SealStoredPayloadsTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
  sealing: PayloadSealing;
  batch?: number;
  budgetMs?: number;
}): SealStoredPayloads {
  const batchSize = deps.batch ?? SEALING_BATCH;
  const budgetMs = deps.budgetMs ?? SEALING_BUDGET_MS;

  const sealBatch = (fleetId: FleetId, after: SealingCursor | null) =>
    withDataKeys({ sealing: deps.sealing, fleetId }, (held) =>
      deps.uow.run(async (tx): Promise<Result<Batch, DataKeysNeeded>> => {
        const { sealings } = tx;
        if (!(await sealings.tryLockSealing(fleetId))) {
          return ok({ kind: 'skipped' });
        }
        const currentDataKeyId = await sealings.currentDataKeyId(fleetId);
        if (currentDataKeyId === undefined) {
          return ok({ kind: 'skipped' });
        }
        const key = held.keys.get(currentDataKeyId);
        if (key === undefined) {
          return err({ kind: 'dataKeysNeeded', dataKeyIds: [currentDataKeyId] });
        }
        const plain = await sealings.plainPayloads(fleetId, { after, limit: batchSize });
        const seal = (row: { fleetId: FleetId; rowId: Message['id'] | Schedule['id'] }, payload: string) => ({ sealed: held.sealer.seal({ key, row }, payload), plainBytes: payloadBytes(payload) });
        const sealed: SealedPayloads = {
          messages: plain.messages.flatMap((message) => sealedMessageRow({ hasher: deps.hasher, key, seal }, message)),
          schedules: plain.schedules.flatMap((schedule) => sealedScheduleRow({ hasher: deps.hasher, key, seal }, schedule)),
        };
        await sealings.sealPayloads(fleetId, sealed);
        const last = plain.messages.at(-1);
        const isMoreLeft = plain.messages.length === batchSize || plain.schedules.length === batchSize;
        return ok(isMoreLeft ? { kind: 'more', after: last === undefined ? after : { createdAt: last.createdAt, id: last.id } } : { kind: 'done' });
      }),
    );

  // Holding the fleet waits for every unit of work that read it before the
  // switch, so a payload such a send stored plain is found here, never missed.
  const markSealedIfNoneLeft = (fleetId: FleetId) =>
    deps.uow.run(async (tx) => {
      const sealing = await tx.sealings.findForUpdate(fleetId);
      if (sealing?.state !== 'sealing' || (await tx.sealings.storesPlainPayload(fleetId))) {
        return ok(undefined);
      }
      await tx.sealings.markSealed(fleetId);
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetPayloadsSealed', occurredAt: deps.clock.now(), actor: SYSTEM });
      return ok(undefined);
    });

  const sealFleet = async (fleetId: FleetId) => {
    const startedAt = deps.clock.now().getTime();
    let after: SealingCursor | null = null;
    for (;;) {
      const result = await sealBatch(fleetId, after);
      // KEY_UNAVAILABLE: the pass waits for the company key (B12) and tries next pass.
      const batch: Batch = result.isOk ? result.value : { kind: 'skipped' };
      if (batch.kind === 'skipped') {
        return;
      }
      if (batch.kind === 'done') {
        await markSealedIfNoneLeft(fleetId);
        return;
      }
      if (deps.clock.now().getTime() - startedAt >= budgetMs) {
        return;
      }
      after = batch.after;
    }
  };

  return async (onFleetError) => {
    for (const fleetId of await deps.sealings.sealingFleetIds()) {
      try {
        await sealFleet(fleetId);
      } catch (error) {
        onFleetError?.(fleetId, error);
      }
    }
  };
}

type Seal = (row: { fleetId: FleetId; rowId: Message['id'] | Schedule['id'] }, payload: string) => SealedRowPayload<Message['id']>['payload'];

/** A plain message sealed for its own row, with its request hash from its row, the payload left out. */
function sealedMessageRow(deps: { hasher: RequestHasher; key: DataKey; seal: Seal }, message: Message): SealedRowPayload<Message['id']>[] {
  if (typeof message.payload !== 'string') {
    return [];
  }
  const requestHash = deps.hasher.hash(sendRequestText({ selector: message.selector, payload: undefined, contentType: message.contentType, inReplyTo: message.inReplyToMessageId ?? undefined, isForced: false }));
  return [{ id: message.id, payload: deps.seal({ fleetId: message.fleetId, rowId: message.id }, message.payload), requestHash }];
}

/** A plain schedule sealed for its own row, with its request hash from its send, the payload left out, as a sealed schedule's. */
function sealedScheduleRow(deps: { hasher: RequestHasher; key: DataKey; seal: Seal }, schedule: Schedule): SealedRowPayload<Schedule['id']>[] {
  const { send } = schedule;
  if (typeof send.payload !== 'string') {
    return [];
  }
  const requestHash = deps.hasher.hash(sendRequestText({ selector: send.selector, payload: undefined, contentType: send.contentType, inReplyTo: send.inReplyTo ?? undefined, isForced: send.isForced }));
  return [{ id: schedule.id, payload: deps.seal({ fleetId: schedule.fleetId, rowId: schedule.id }, send.payload), requestHash }];
}
