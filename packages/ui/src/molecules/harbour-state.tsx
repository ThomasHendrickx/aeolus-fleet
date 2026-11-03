import type { HarbourState } from '@aeolus-fleet/common/rules';
import { CircleAlert, CirclePause, CirclePlay, Hourglass, Network, Plug, SquareTerminal, User, Users, type LucideIcon } from 'lucide-react';

/**
 * Harbour's words, icons and groups (docs/design/fleet-overview), shared by
 * its numbers, groups and tiles. A state's icon always sits beside its word,
 * so status never rests on colour alone.
 */
export const HARBOUR_STATE_WORDS: Record<HarbourState, string> = {
  alert: 'Alert',
  waiting: 'Waiting',
  working: 'Working',
  idle: 'Idle',
};

const STATE_ICONS: Record<HarbourState, LucideIcon> = {
  alert: CircleAlert,
  waiting: Hourglass,
  working: CirclePlay,
  idle: CirclePause,
};

/** A state's mark, beside its word. */
export function HarbourStateIcon({ state, className }: { state: HarbourState; className?: string }) {
  const Icon = STATE_ICONS[state];
  return <Icon aria-hidden className={className ?? 'size-3 shrink-0'} />;
}

/** Harbour's groups, in the order it shows them: People, Agents, Plugins, Through the gateway. */
export const HARBOUR_GROUP_KINDS = ['people', 'agents', 'plugins', 'gateway'] as const;

export type HarbourGroupKind = (typeof HARBOUR_GROUP_KINDS)[number];

export const HARBOUR_GROUP_LOOK: Record<HarbourGroupKind, { word: string; Icon: LucideIcon; kindWord: string; KindIcon: LucideIcon }> = {
  people: { word: 'People', Icon: Users, kindWord: 'Person', KindIcon: User },
  agents: {
    word: 'Agents',
    Icon: SquareTerminal,
    kindWord: 'Agent',
    KindIcon: SquareTerminal,
  },
  plugins: { word: 'Plugins', Icon: Plug, kindWord: 'Plugin', KindIcon: Plug },
  gateway: {
    word: 'Through the gateway',
    Icon: Network,
    kindWord: 'Through the gateway',
    KindIcon: Network,
  },
};
