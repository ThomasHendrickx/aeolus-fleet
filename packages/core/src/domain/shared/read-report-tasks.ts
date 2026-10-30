/** Message task links, resolved in a batch for the viewer of the report (monitoring 4.2). */
import { idSchema, type MessageId, type ReportTask } from '@aeolus-fleet/common';

import { hasScope, type Caller } from './caller.js';
import type { ShipHistory } from './history.js';
import { readsMessage, type MessageParties, type ReadReachOf } from '../registry/public.js';

export type ReadReportTasks = (caller: Caller, tasks: readonly (ReportTask | null)[]) => Promise<(ReportTask | null)[]>;

export function createReadReportTasks(deps: { history: Pick<ShipHistory, 'messageParties'>; readReach: ReadReachOf }): ReadReportTasks {
  return async (caller, tasks) => {
    const ids = tasks.flatMap((task) => {
      const id = idSchema('message').safeParse(task?.messageId);
      return task?.kind === 'message' && task.fleetId === caller.fleetId && id.success ? [id.data] : [];
    });
    const canRead = hasScope(caller, 'fleet:read');
    const parties: ReadonlyMap<MessageId, MessageParties> = canRead && ids.length > 0 ? await deps.history.messageParties(caller.fleetId, [...new Set(ids)]) : new Map();
    const reach = canRead && ids.length > 0 ? await deps.readReach(caller) : null;
    return tasks.map((task) => {
      if (task?.kind !== 'message') {
        return task;
      }
      const id = idSchema('message').safeParse(task.messageId);
      const message = id.success ? parties.get(id.data) : undefined;
      return { ...task, fleetName: null, canOpen: task.fleetId === caller.fleetId && reach !== null && message !== undefined && readsMessage(reach, message) };
    });
  };
}
