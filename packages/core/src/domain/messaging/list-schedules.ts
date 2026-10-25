import type { IdGenerator, ScheduleId, ScheduleState, ShipId } from '@aeolus-fleet/common';

import { labelValueTexts, type CheckManageTx, type LabelValueTextsTx, type NotReachable } from '../registry/public.js';
import { hasScope, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { HistoryLabelValue } from '../shared/history.js';
import { keepingReachRefusal } from '../registry/public.js';
import type { Page, PageQuery } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ScheduleRepository } from './ports.js';
import type { Schedule } from './schedule.js';
import { scheduleAccess } from './schedule-access.js';

export interface ListSchedulesTx extends Omit<CheckManageTx, 'labels'> {
  labels: CheckManageTx['labels'] & LabelValueTextsTx['labels'];
  schedules: Pick<ScheduleRepository, 'page'>;
}

/** A page of schedules, and the texts of every label value its selections name: none unless the caller holds fleet:read. */
export interface SchedulesPage extends Page<Schedule, ScheduleId> {
  labelValues: readonly HistoryLabelValue[];
}

/** The states a list shows unless asked for others: the schedules that still send. */
const OPEN_STATES: readonly ScheduleState[] = ['active', 'paused'];

export type ListSchedulesRefusal = DomainError<'FORBIDDEN'> | NotReachable;

export type ListSchedules = (
  caller: Caller,
  input: { shipId: ShipId; states?: readonly ScheduleState[] } & PageQuery<ScheduleId>,
) => Promise<Result<SchedulesPage, ListSchedulesRefusal>>;

/**
 * Use case: a page of a ship's schedules, newest first (`schedules`,
 * decision 0062), its active and paused ones unless the caller asks for other
 * states, so a ship reads a once schedule's outcome after it ended. Its ship
 * lists its own; an actor with fleet:manage within manage reach lists any.
 * A caller holding fleet:read also reads each label value the page's
 * selections name by its key and value (decision 0065, R10), in one read;
 * others read the value ids as given.
 */
export function createListSchedules(deps: { uow: UnitOfWork<ListSchedulesTx>; clock: Clock; ids: IdGenerator }): ListSchedules {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<SchedulesPage, ListSchedulesRefusal>> => {
      const access = await scheduleAccess({ tx, ids: deps.ids }, { caller, shipId: input.shipId, at: deps.clock.now() });
      if (!access.isOk) {
        return access;
      }
      if (access.value === 'none') {
        return refuse('FORBIDDEN', "Listing another ship's schedules needs the fleet:manage scope");
      }
      const { shipId, cursor, limit } = input;
      const page = await tx.schedules.page(caller.fleetId, { shipId, states: input.states ?? OPEN_STATES, limit, ...(cursor === undefined ? {} : { cursor }) });
      const valueIds = hasScope(caller, 'fleet:read') ? page.items.flatMap(({ send }) => (send.selector.kind === 'label' ? send.selector.valueIds : [])) : [];
      return ok({ ...page, labelValues: await labelValueTexts(tx, { fleetId: caller.fleetId, valueIds }) });
    });
}
