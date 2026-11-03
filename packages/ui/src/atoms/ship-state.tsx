import { Activity, Archive, CircleDashed, CirclePause, OctagonPause, TriangleAlert, UserCheck, type LucideIcon } from 'lucide-react';

import { classNames } from '../class-names.js';

/**
 * A ship's state as every app shows it (docs/design/state-colours, "Without
 * colour"): one icon and one word per state, in the tone that means it
 * (conventions.md, Colour). The five states, first match wins, then the
 * status that shows beside them: Crewed and Retired. SHIP_STATES holds them
 * in the order the sheet draws them.
 */
export const SHIP_STATES = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle', 'crewed', 'retired'] as const;

export type ShipStateShown = (typeof SHIP_STATES)[number];

/** The tone family that means a state; Idle carries none. */
type Tone = 'attention' | 'waiting' | 'blocked' | 'active' | 'ok' | 'ended';

interface ShipStateLook {
  readonly word: string;
  readonly Icon: LucideIcon;
  readonly tone: Tone | null;
}

const LOOKS: Record<ShipStateShown, ShipStateLook> = {
  alert: { word: 'Alert', Icon: TriangleAlert, tone: 'attention' },
  awaitingCrew: { word: 'Awaiting crew', Icon: CircleDashed, tone: 'waiting' },
  blocked: { word: 'Blocked', Icon: OctagonPause, tone: 'blocked' },
  working: { word: 'Working', Icon: Activity, tone: 'active' },
  idle: { word: 'Idle', Icon: CirclePause, tone: null },
  crewed: { word: 'Crewed', Icon: UserCheck, tone: 'ok' },
  retired: { word: 'Retired', Icon: Archive, tone: 'ended' },
};

/** Text and icon in the tone's foreground; Idle in the muted foreground. */
const TONE_TEXT: Record<Tone | 'none', string> = {
  attention: 'text-tone-attention-fg',
  waiting: 'text-tone-waiting-fg',
  blocked: 'text-tone-blocked-fg',
  active: 'text-tone-active-fg',
  ok: 'text-tone-ok-fg',
  ended: 'text-tone-ended-fg',
  none: 'text-muted-foreground',
};

/** A badge is filled in its tone; Idle's stays on the card. */
const TONE_FILL: Record<Tone | 'none', string> = {
  attention: 'border-tone-attention-border bg-tone-attention-bg',
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg',
  blocked: 'border-tone-blocked-border bg-tone-blocked-bg',
  active: 'border-tone-active-border bg-tone-active-bg',
  ok: 'border-tone-ok-border bg-tone-ok-bg',
  ended: 'border-tone-ended-border bg-tone-ended-bg',
  none: 'border-border bg-card',
};

const SIZES = { meta: 'text-meta', caption: 'text-caption' } as const;

export interface ShipStateProps {
  state: ShipStateShown;
  /** Filled in its tone, as the Alert badge after a ship's status. */
  isBadge?: boolean;
  /** The word's size: meta in a list or on a page, caption on a tile or a number. A badge is always caption. */
  size?: keyof typeof SIZES;
  className?: string;
}

/** A ship's state or status: its icon and word in its tone, plain or as a badge. */
export function ShipState({ state, isBadge = false, size = 'meta', className }: ShipStateProps) {
  const { word, Icon, tone: toneOrNone } = LOOKS[state];
  const tone = toneOrNone ?? 'none';
  return (
    <span
      data-testid="ship-state"
      data-tone={tone}
      className={classNames(
        'inline-flex items-center gap-1.5 font-medium',
        TONE_TEXT[tone],
        isBadge ? classNames('rounded-full border px-2 py-px text-caption', TONE_FILL[tone]) : SIZES[size],
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {word}
    </span>
  );
}
