'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAccess } from '../../lib/access';
import { allowedPaletteItems, paletteItemsOf } from '../../lib/command-palette';
import { useFleetSnapshot } from '../../lib/fleet';
import { useHasSquadrons } from '../../lib/squadrons';
import { useCatalogue, useSquadrons } from '../../lib/squadrons-api';
import { blueprintChoices } from '../../lib/squadrons-view';
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
 * page its route, Compose the page's Compose, Commission ship the fleet
 * overview with its CommissionDialog open, and with squadrons on, a squadron
 * or blueprint its page and Form squadron the Squadrons page with its dialog
 * open.
 */
export function ConsoleCommands({ isOpen, onOpenChange, onCompose }: ConsoleCommandsProps) {
  const router = useRouter();
  const fleet = useFleetSnapshot();
  const hasSquadrons = useHasSquadrons();
  const squadrons = useSquadrons();
  const catalogue = useCatalogue();
  const access = useAccess();

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
      items={allowedPaletteItems(
        paletteItemsOf(
          fleet.data ?? [],
          hasSquadrons ? { squadrons: squadrons.data ?? [], blueprints: blueprintChoices(catalogue.data ?? { blueprints: [] }) } : undefined,
        ),
        access,
      )}
      onSelect={(item) => {
        switch (item.kind) {
          case 'ship':
          case 'page':
          case 'squadron':
          case 'squadron-action':
          case 'blueprint':
            router.push(item.href);
            return;
          case 'action':
            if (item.id === 'compose') {
              onCompose();
            } else if (item.id === 'form-squadron') {
              router.push('/squadrons?form=new');
            } else {
              router.push('/?commission=new');
            }
        }
      }}
    />
  );
}
