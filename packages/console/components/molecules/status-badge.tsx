import type { CrewStatus, DeliveryState, ScheduleState, ShipStatus, StuckCause } from '@aeolus-fleet/common';
import {
  AlarmClock,
  Anchor,
  Archive,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CircleAlert,
  CircleArrowRight,
  CircleCheckBig,
  CirclePause,
  CirclePlay,
  CircleSlash,
  Clock,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleMinus,
  CircleX,
  FlagOff,
  Gauge,
  Hourglass,
  Inbox,
  LoaderCircle,
  MailCheck,
  OctagonAlert,
  Power,
  RotateCcw,
  Sailboat,
  TriangleAlert,
  UserCheck,
  UserRoundSearch,
  type LucideIcon,
} from 'lucide-react';

import { classNames } from '@aeolus-fleet/common/header';
import type { SquadronState } from '../../lib/squadron-states';

/** A count at its limit, or over it once a limit is lowered below use (the LimitMeter part). */
export type LimitState = 'at-limit' | 'over-limit';
/** A crew request with no trierarch: on the operator's to-do, or crewed by hand. */
export type UnassignedCrewState = 'needsCrew' | 'crewedByHand';
/** A step of a pushed delivery's way: handed to its agent by the computer side, or overdue by the 10 or 60 minute clock (decision 0040). */
export type PushedStepState = 'handedPushed' | 'overdue';
/** The fleet's health (decision 0042): its verdict, stuck or delivering, and why a delivery is stuck. */
export type HealthState = 'stuck' | 'delivering' | StuckCause;
type Status = ShipStatus | DeliveryState | SquadronState | LimitState | CrewStatus | UnassignedCrewState | PushedStepState | HealthState | ScheduleState;
import { Badge } from '../atoms/badge';

type Tone = 'waiting' | 'active' | 'ok' | 'attention' | 'ended';

const TONE_CLASSES: Record<Tone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

/**
 * Every ship status, delivery state, squadron state, limit state, crew request state and schedule state with its tone, icon
 * and label (docs/design/conventions.md, "Colour"). A handed delivery is in
 * flight: a receive handed it to a crew, which has not acknowledged it yet. A
 * receive is all a pull ship does, so handed reads "Handed (pulled)"; a
 * pushed ship's computer side hands it to its agent, which reads "Handed". A
 * step is overdue when the 10 or 60 minute clock told argo. A
 * received delivery is in flight with a pushed ship's computer side, not yet
 * handed to its agent. Handled and not handled say how the turn that took
 * an acknowledged delivery ended: by itself, or died twice.
 */
const STATUSES: Record<Status, { tone: Tone; Icon: LucideIcon; label: string }> = {
  awaitingCrew: { tone: 'waiting', Icon: CircleDashed, label: 'Awaiting crew' },
  crewed: { tone: 'ok', Icon: UserCheck, label: 'Crewed' },
  retired: { tone: 'ended', Icon: Archive, label: 'Retired' },
  pending: { tone: 'waiting', Icon: Hourglass, label: 'Pending' },
  received: { tone: 'active', Icon: Inbox, label: 'Received' },
  handed: { tone: 'active', Icon: CircleArrowRight, label: 'Handed (pulled)' },
  handedPushed: { tone: 'active', Icon: CircleArrowRight, label: 'Handed' },
  overdue: { tone: 'attention', Icon: AlarmClock, label: 'Overdue' },
  acknowledged: { tone: 'ok', Icon: CircleCheck, label: 'Acknowledged' },
  handled: { tone: 'ok', Icon: CircleCheckBig, label: 'Handled' },
  notHandled: { tone: 'attention', Icon: CircleAlert, label: 'Not handled' },
  undeliverable: { tone: 'attention', Icon: CircleX, label: 'Undeliverable' },
  dismissed: { tone: 'ended', Icon: CircleMinus, label: 'Dismissed' },
  abandoned: { tone: 'ended', Icon: Ban, label: 'Abandoned' },
  forming: { tone: 'waiting', Icon: CircleDotDashed, label: 'Forming' },
  sailing: { tone: 'ok', Icon: Sailboat, label: 'Sailing' },
  'standing-down': { tone: 'active', Icon: Anchor, label: 'Standing down' },
  disbanded: { tone: 'ended', Icon: FlagOff, label: 'Disbanded' },
  'at-limit': { tone: 'waiting', Icon: Gauge, label: 'At limit' },
  'over-limit': { tone: 'attention', Icon: TriangleAlert, label: 'Over limit' },
  needsCrew: { tone: 'waiting', Icon: Clock, label: 'Needs crew' },
  crewedByHand: { tone: 'ok', Icon: UserCheck, label: 'Crewed by hand' },
  crewing: { tone: 'active', Icon: LoaderCircle, label: 'Crewing' },
  running: { tone: 'ok', Icon: CirclePlay, label: 'Running' },
  restarting: { tone: 'waiting', Icon: RotateCcw, label: 'Restarting' },
  crashed: { tone: 'attention', Icon: CircleX, label: 'Crashed' },
  releasing: { tone: 'active', Icon: Power, label: 'Releasing' },
  stuck: { tone: 'attention', Icon: OctagonAlert, label: 'Stuck' },
  delivering: { tone: 'ok', Icon: MailCheck, label: 'Delivering' },
  noShipCanTake: { tone: 'attention', Icon: CircleSlash, label: 'No ship can take' },
  waitingForCrew: { tone: 'waiting', Icon: UserRoundSearch, label: 'Waiting for crew' },
  stalledInFlight: { tone: 'waiting', Icon: CirclePause, label: 'Stalled in flight' },
  active: { tone: 'ok', Icon: CalendarClock, label: 'Active' },
  paused: { tone: 'waiting', Icon: CirclePause, label: 'Paused' },
  ended: { tone: 'ended', Icon: CalendarCheck, label: 'Ended' },
  cancelled: { tone: 'ended', Icon: CalendarX, label: 'Cancelled' },
};

/**
 * One component for every ship status and delivery state
 * (docs/design/png/StatusBadge.png). Colour comes from the tone family, and
 * each state has its own icon and label, so it reads without colour.
 * Abandoned has a dashed border to set it apart from Dismissed.
 */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { tone, Icon, label } = STATUSES[status];
  return (
    <Badge
      variant="outline"
      data-slot="status-badge"
      data-status={status}
      className={classNames(TONE_CLASSES[tone], status === 'abandoned' ? 'border-dashed' : undefined, className)}
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/** The label a status or state reads as, for a sentence beside the badge: "In flight". */
export function statusLabel(status: Status): string {
  return STATUSES[status].label;
}
