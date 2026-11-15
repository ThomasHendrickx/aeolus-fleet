import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { themeScript } from './first-paint-theme.js';

/** A page's <html> and the browser's colour setting, as the first-paint script meets them. */
function aPage({ isSystemDark }: { isSystemDark: boolean }) {
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const root = {
    dataset,
    classList: {
      toggle: (name: string, isOn: boolean) => {
        if (isOn) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
  };
  const window = { matchMedia: () => ({ matches: isSystemDark, addEventListener: () => undefined }) };
  return {
    run: (script: string) => {
      runInNewContext(script, { document: { documentElement: root }, window });
    },
    isDark: () => classes.has('dark'),
    theme: () => root.dataset.theme,
  };
}

describe('every app shows the browser theme from the first paint (header-across-apps T1)', () => {
  it('shows Dark before the page renders when the browser keeps Dark', () => {
    // Given a browser set to light colours that keeps Dark
    const page = aPage({ isSystemDark: false });
    // When the first-paint script runs
    page.run(themeScript('dark'));
    // Then the page is dark
    expect([page.theme(), page.isDark()]).toEqual(['dark', true]);
  });

  it('shows Light over a dark system when the browser keeps Light', () => {
    // Given a browser set to dark colours that keeps Light
    const page = aPage({ isSystemDark: true });
    // When the first-paint script runs
    page.run(themeScript('light'));
    // Then the page is light
    expect([page.theme(), page.isDark()]).toEqual(['light', false]);
  });

  it('System follows the browser setting', () => {
    // Given a browser set to dark colours that keeps System
    const page = aPage({ isSystemDark: true });
    // When the first-paint script runs
    page.run(themeScript('system'));
    // Then the page is dark
    expect([page.theme(), page.isDark()]).toEqual(['system', true]);
  });
});
