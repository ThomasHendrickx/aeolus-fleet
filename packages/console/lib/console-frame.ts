'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';

import type { SidebarDestination } from '../components/organisms/sidebar';

/**
 * What the signed-in route layout hands each page for its ListPage or
 * DetailPage: the header's switcher and avatar menu, Compose and the
 * CommandPalette (both held by the layout), and the installation's notices.
 */
export interface ConsoleFrame {
  /** Undefined until the session is read. */
  switcher: AppSwitcherModel | undefined;
  account: AvatarMenuProps;
  /** Opens Compose; none while the session may not send. */
  onCompose?: () => void;
  onSearch: () => void;
  banner: ReactNode;
}

export const ConsoleFrameContext = createContext<ConsoleFrame | undefined>(undefined);

export function useConsoleFrame(): ConsoleFrame {
  const frame = useContext(ConsoleFrameContext);
  if (frame === undefined) {
    throw new Error('useConsoleFrame runs inside the signed-in route layout, which provides it');
  }
  return frame;
}

/** The navigation's destination a path sits under: a ship's page and the labels belong to the fleet overview. */
export function destinationOf(pathname: string): SidebarDestination {
  const [, top = ''] = pathname.split('/');
  switch (top) {
    case 'needs-crew':
    case 'squadrons':
    case 'trierarchs':
    case 'inbox':
    case 'network':
    case 'settings':
      return top;
    case 'fleet-health':
    case 'needs-attention':
      return 'health';
    default:
      return 'overview';
  }
}
