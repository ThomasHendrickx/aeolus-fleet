import type { Decorator, Preview } from '@storybook/nextjs-vite';
import { useLayoutEffect, type ReactNode } from 'react';

import { TooltipProvider } from '../components/atoms/tooltip';
import { ConsoleConstantsContext } from '../lib/console-constants';
import { consoleConstantsOf } from '../lib/console-constants-of';
import { geistMono, geistSans } from '../app/fonts';
import '../app/globals.css';

/**
 * Light or dark, from the toolbar: .dark on <html> as in the console, so
 * portalled parts (dialogs, sheets, menus, toasts) follow too.
 */
function ThemedCanvas({ isDark, children }: { isDark: boolean; children: ReactNode }) {
  // Storybook's document is an outside system to the story: set its class before paint.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.classList.add(geistSans.variable, geistMono.variable);
  }, [isDark]);
  // The values the root layout hands down in the console.
  return (
    <ConsoleConstantsContext value={consoleConstantsOf()}>
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6 text-foreground">{children}</div>
      </TooltipProvider>
    </ConsoleConstantsContext>
  );
}

const withTheme: Decorator = (Story, context) => (
  <ThemedCanvas isDark={context.globals.theme === 'dark'}>
    <Story />
  </ThemedCanvas>
);

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Light or dark theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
  },
};

export default preview;
