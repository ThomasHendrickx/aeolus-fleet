import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppHeader } from './app-header.js';

const ACCOUNT = {
  name: undefined,
  signedInAs: undefined,
  theme: undefined,
  themes: [],
  hasTheme: false,
  onThemeChange: () => undefined,
  shortcuts: [],
  helpUrl: 'https://example.com/help',
  onSignOut: () => undefined,
  isSigningOut: false,
};

describe('the header while the fleet in view is not known yet', () => {
  it('shows the shape of the title, not a blank', () => {
    const html = renderToStaticMarkup(createElement(AppHeader, { switcher: undefined, account: ACCOUNT }));

    expect(html).toContain('data-testid="app-switcher-loading"');
  });
});
