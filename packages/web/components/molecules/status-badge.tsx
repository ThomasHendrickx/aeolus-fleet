import type { DeliveryState, ShipStatus } from '@aeolus-fleet/common';
import {
  Anchor,
  Archive,
  Ban,
  CircleArrowRight,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleMinus,
  CircleX,
  FlagOff,
  Hourglass,
  Sailboat,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

import { classNames } from '../../lib/class-names';
import type { SquadronState } from '../../lib/squadrons-api';
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
 * Every ship status, delivery state and squadron state with its tone, icon
 * and label (docs/design/conventions.md, "Colour"). A delivered delivery is in
 * flight: claimed by a crew and not yet acknowledged.
 */
const STATUSES: Record<ShipStatus | DeliveryState | SquadronState, { tone: Tone; Icon: LucideIcon; label: string }> = {
  awaitingCrew: { tone: 'waiting', Icon: CircleDashed, label: 'Awaiting crew' },
  crewed: { tone: 'ok', Icon: UserCheck, label: 'Crewed' },
  retired: { tone: 'ended', Icon: Archive, label: 'Retired' },
  pending: { tone: 'waiting', Icon: Hourglass, label: 'Pending' },
  delivered: { tone: 'active', Icon: CircleArrowRight, label: 'In flight' },
  acknowledged: { tone: 'ok', Icon: CircleCheck, label: 'Acknowledged' },
  undeliverable: { tone: 'attention', Icon: CircleX, label: 'Undeliverable' },
  dismissed: { tone: 'ended', Icon: CircleMinus, label: 'Dismissed' },
  abandoned: { tone: 'ended', Icon: Ban, label: 'Abandoned' },
  forming: { tone: 'waiting', Icon: CircleDotDashed, label: 'Forming' },
  sailing: { tone: 'ok', Icon: Sailboat, label: 'Sailing' },
  'standing-down': { tone: 'active', Icon: Anchor, label: 'Standing down' },
  disbanded: { tone: 'ended', Icon: FlagOff, label: 'Disbanded' },
};

/**
 * One component for every ship status and delivery state
 * (docs/design/png/StatusBadge.png). Colour comes from the tone family, and
 * each state has its own icon and label, so it reads without colour.
 * Abandoned has a dashed border to set it apart from Dismissed.
 */
export function StatusBadge({ status, className }: { status: ShipStatus | DeliveryState | SquadronState; className?: string }) {
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
export function statusLabel(status: ShipStatus | DeliveryState | SquadronState): string {
  return STATUSES[status].label;
}
