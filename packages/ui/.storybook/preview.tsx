import type { Decorator, Preview } from '@storybook/react-vite';
import { useLayoutEffect, type ReactNode } from 'react';

import { TooltipProvider } from '../src/atoms/tooltip.js';
import './preview.css';

/**
 * Light or dark, from the toolbar: .dark on <html> as in every app, so
 * portalled parts (dialogs, sheets, menus) follow too.
 */
function ThemedCanvas({ isDark, children }: { isDark: boolean; children: ReactNode }) {
  // Storybook's document is an outside system to the story: set its class before paint.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-6 text-foreground">{children}</div>
    </TooltipProvider>
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
