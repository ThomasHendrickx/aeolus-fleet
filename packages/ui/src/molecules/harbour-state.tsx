import { Network, Plug, SquareTerminal, User, Users, type LucideIcon } from 'lucide-react';

/**
 * Harbour's groups (docs/design/fleet-overview), shared by its groups and
 * tiles. A ship's state shows through ShipState, as everywhere else.
 */

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
