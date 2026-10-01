'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { paletteItemsOf } from '../../lib/command-palette';
import { useFleetSnapshot } from '../../lib/fleet';
import { CommandPalette } from './command-palette';

interface ConsoleCommandsProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Opens Compose on this page. */
  onCompose: () => void;
}

/**
 * The CommandPalette on every console page, with the fleet's ships, the
 * actions and the pages; Cmd+K (Ctrl+K) opens it. A ship opens its page, a
 * page its route, Compose the page's Compose, and Commission ship the fleet
 * overview with its CommissionDialog open.
 */
export function ConsoleCommands({ isOpen, onOpenChange, onCompose }: ConsoleCommandsProps) {
  const router = useRouter();
  const fleet = useFleetSnapshot();

  useEffect(() => {
    const openOnShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', openOnShortcut);
    return () => {
      document.removeEventListener('keydown', openOnShortcut);
    };
  }, [onOpenChange]);

  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      items={paletteItemsOf(fleet.data ?? [])}
      onSelect={(item) => {
        switch (item.kind) {
          case 'ship':
          case 'page':
            router.push(item.href);
            return;
          case 'action':
            if (item.id === 'compose') {
              onCompose();
            } else {
              router.push('/?commission=new');
            }
        }
      }}
    />
  );
}
