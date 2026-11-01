import { CircleAlert, CirclePause, CirclePlay, Hourglass, type LucideIcon } from 'lucide-react';

import type { HarbourState } from '@aeolus-fleet/common/rules';

/**
 * Each Harbour state with its word, icon and tone classes
 * (docs/design/fleet-overview): Alert in attention, Waiting in waiting,
 * Working in ok; Idle stays plain, so colour marks only what is going on.
 * The icon and word say the state, never colour alone.
 */
export const HARBOUR_STATE_LOOK: Record<HarbourState, { word: string; Icon: LucideIcon; text: string; fill: string }> = {
  alert: { word: 'Alert', Icon: CircleAlert, text: 'text-tone-attention-fg', fill: 'border-tone-attention-border bg-tone-attention-bg' },
  waiting: { word: 'Waiting', Icon: Hourglass, text: 'text-tone-waiting-fg', fill: 'border-tone-waiting-border bg-tone-waiting-bg' },
  working: { word: 'Working', Icon: CirclePlay, text: 'text-tone-ok-fg', fill: 'border-tone-ok-border bg-tone-ok-bg' },
  idle: { word: 'Idle', Icon: CirclePause, text: 'text-tone-ended-fg', fill: 'border-border bg-card' },
};
