'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { AccountMenuProps } from '../components/organisms/account-menu';
import type { SidebarDestination } from '../components/organisms/sidebar';

/**
 * What the signed-in route layout hands each page for its ListPage or
 * DetailPage: the operator's account, Compose and the CommandPalette (both
 * held by the layout), and the installation's notices.
 */
export interface ConsoleFrame {
  account: AccountMenuProps;
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
    case 'needs-attention':
      return 'attention';
    default:
      return 'overview';
  }
}
