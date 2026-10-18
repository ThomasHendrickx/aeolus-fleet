import type { ComputerSide, MessageId, ShipWay } from '@aeolus-fleet/common';

import { relativeTime, sinceTime } from '../../../lib/relative-time';
import type { DeliveryStepState } from './delivery-history';
import { deliveryStatus, type WayLine, type WayMachine } from './message-way';

/**
 * A ship's side of the way as its header shows it (#756): which part serves
 * it, whether that part answers, its turn, and its oldest delivery waiting.
 * Short lines: the icon, the tone and the badge carry the rest.
 */

/** The ship's oldest delivery waiting, as one line that opens its message. */
export interface OldestWaiting {
  messageId: MessageId;
  status: DeliveryStepState;
  isOverdue: boolean;
  text: string;
}

export interface ShipWayView {
  lines: WayLine[];
  oldest: OldestWaiting | null;
}

function sideLine(by: ComputerSide | null): WayLine {
  if (by === null) {
    return { icon: 'pull', tone: 'neutral', text: 'No trierarch, no plugin (pull)' };
  }
  return by.kind === 'trierarch'
    ? { icon: 'computer', tone: 'neutral', text: `Trierarch on ${by.trierarch.name}` }
    : { icon: 'watcher', tone: 'neutral', text: 'Plugin watcher' };
}

/** "Trierarch on mac-mini silent since 10:02", when the trierarch plugin says its machine is silent. */
function silentLines(by: ComputerSide | null, context: { now: Date; machines: readonly WayMachine[] }): WayLine[] {
  if (by?.kind !== 'trierarch') {
    return [];
  }
  const machine = context.machines.find((each) => each.shipId === by.trierarch.id);
  if (!machine?.isSilent) {
    return [];
  }
  const seen = machine.lastSeenAt === null ? '' : ` since ${sinceTime(new Date(machine.lastSeenAt), context.now)}`;
  return [{ icon: 'silent', tone: 'attention', text: `Trierarch on ${by.trierarch.name} silent${seen}` }];
}

function turnLines(turn: NonNullable<ShipWay['lease']>['turn'], now: Date): WayLine[] {
  if (turn === null) {
    return [];
  }
  const since = sinceTime(new Date(turn.at), now);
  return turn.turn === 'busy'
    ? [{ icon: 'busy', tone: 'active', text: `Busy since ${since}` }]
    : [{ icon: 'idle', tone: 'neutral', text: `Idle since ${since}` }];
}

/** "12 min ago · not confirmed · argo told at 10 min · oldest of 3". */
function oldestOf(way: ShipWay, now: Date): OldestWaiting | null {
  const { oldest, waiting } = way;
  if (oldest === null) {
    return null;
  }
  const { state, way: deliveryWay } = oldest.delivery;
  const words = [relativeTime(new Date(deliveryWay.since), now).toLowerCase()];
  if (state === 'handed') {
    words.push(deliveryWay.isPulled ? 'not acknowledged' : 'not confirmed');
  }
  if (deliveryWay.overdue) {
    words.push(`argo told at ${String(deliveryWay.overdue.minutes)} min`);
  }
  if (waiting > 1) {
    words.push(`oldest of ${String(waiting)}`);
  }
  return {
    messageId: oldest.messageId,
    status: deliveryStatus({ state, isPulled: deliveryWay.isPulled }),
    isOverdue: deliveryWay.overdue !== null,
    text: words.join(' · '),
  };
}

/**
 * The ship's side of the way: the part that serves its lease (the trierarch
 * on its computer, the plugin watcher, or none on a pull lease), a silent
 * trierarch, the turn, then nothing waiting or its oldest delivery waiting.
 * Nothing while no session crews it.
 */
export function shipWayView(way: ShipWay, context: { now: Date; machines?: readonly WayMachine[] }): ShipWayView {
  const { now, machines = [] } = context;
  if (way.lease === null) {
    return { lines: [], oldest: null };
  }
  const { by, turn } = way.lease;
  const nothingWaits: WayLine[] = way.waiting === 0 ? [{ icon: 'time', tone: 'neutral', text: 'Nothing waiting' }] : [];
  return {
    lines: [sideLine(by), ...silentLines(by, { now, machines }), ...turnLines(turn, now), ...nothingWaits],
    oldest: oldestOf(way, now),
  };
}
