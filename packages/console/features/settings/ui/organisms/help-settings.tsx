'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Kbd } from '@aeolus-fleet/ui';
import { ArrowUpRight, CircleHelp, Compass, Keyboard } from 'lucide-react';
import { useState } from 'react';

import { SETTINGS_ROW, SettingsRows, SettingsSection } from '../molecules/settings-section';

/** A keyboard shortcut the console offers: its keys and what they do. */
export interface Shortcut {
  keys: readonly string[];
  label: string;
}

interface HelpSettingsProps {
  shortcuts: readonly Shortcut[];
  /** The documentation, opened in a new tab. */
  helpUrl: string;
  /** Opens the guide's first step; unset while no guide is set for the session (0024). */
  onTakeTour?: () => void;
}

/**
 * Settings, Help (docs/design/app-navigation, where the account menu's
 * items go): Keyboard shortcuts on desktop only (H6), opening their dialog;
 * Help, the documentation in a new tab; and Take the tour where a guide is set.
 */
export function HelpSettings({ shortcuts, helpUrl, onTakeTour }: HelpSettingsProps) {
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  return (
    <SettingsSection id="settings-help" title="Help">
      <SettingsRows>
        <li className="max-sm:hidden">
          <button
            type="button"
            data-testid="settings-shortcuts"
            className={SETTINGS_ROW}
            onClick={() => {
              setIsShortcutsOpen(true);
            }}
          >
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </button>
        </li>
        <li>
          <a href={helpUrl} target="_blank" rel="noreferrer" data-testid="settings-help" className={SETTINGS_ROW}>
            <CircleHelp aria-hidden />
            <span className="flex grow flex-col">
              Help
              <span className="text-meta font-normal text-muted-foreground max-sm:text-body">Opens in a new tab</span>
            </span>
            <ArrowUpRight aria-hidden />
          </a>
        </li>
        {onTakeTour === undefined ? null : (
          <li>
            <button type="button" data-testid="settings-take-tour" className={SETTINGS_ROW} onClick={onTakeTour}>
              <Compass aria-hidden />
              Take the tour
            </button>
          </li>
        )}
      </SettingsRows>
      <Dialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>
        <DialogContent size="sm" data-testid="settings-shortcuts-dialog">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>What the keys do here.</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.label} className="flex items-center justify-between gap-4 text-body text-foreground">
                {shortcut.label}
                <span className="flex gap-1">
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
