'use client';

import type { Theme } from '@aeolus-fleet/common';
import { classNames } from '@aeolus-fleet/ui';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '../molecules/settings-section';

interface ThemeSettingsProps {
  /** The theme this browser keeps; undefined until read. */
  theme: Theme | undefined;
  themes: readonly Theme[];
  /** Whether this sign-in may change it: a viewer shows the browser's theme and has no switch (0022). */
  hasThemeSwitch: boolean;
  onThemeChange: (theme: Theme) => void;
}

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Settings, Theme (docs/design/app-navigation, where the account menu's
 * items go): one theme per browser, in every Aeolus app (header-across-apps
 * T1 to T4), as Light, Dark and System, the one chosen pressed. A press
 * applies it at once, keeps focus on its button and announces it. A viewer
 * reads that it has no switch.
 */
export function ThemeSettings({ theme, themes, hasThemeSwitch, onThemeChange }: ThemeSettingsProps) {
  const [announced, setAnnounced] = useState('');
  return (
    <SettingsSection id="settings-theme" title="Theme" line="This browser, every Aeolus app">
      {hasThemeSwitch ? (
        <>
          <div className="grid w-full max-w-90 grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {themes.map((option) => {
              const Icon = THEME_ICONS[option];
              const isChosen = option === theme;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={isChosen}
                  disabled={theme === undefined}
                  data-testid={`settings-theme-${option}`}
                  onClick={() => {
                    onThemeChange(option);
                    setAnnounced(`Theme: ${THEME_LABELS[option]}`);
                  }}
                  className={classNames(
                    'inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-body text-muted-foreground outline-none transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 max-sm:h-(--size-control-touch) max-sm:text-body-touch [&_svg]:size-(--size-icon)',
                    isChosen && 'bg-background text-foreground shadow-xs',
                  )}
                >
                  <Icon aria-hidden />
                  {THEME_LABELS[option]}
                </button>
              );
            })}
          </div>
          <p role="status" className="sr-only">
            {announced}
          </p>
        </>
      ) : (
        <p className="text-body text-foreground max-sm:text-body-touch">A viewer sign-in shows this browser’s theme and has no theme switch.</p>
      )}
    </SettingsSection>
  );
}
