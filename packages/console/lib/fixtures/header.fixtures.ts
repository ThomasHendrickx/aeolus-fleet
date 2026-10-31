import { idSchema, THEMES } from '@aeolus-fleet/common';
import type { AvatarMenuProps } from '@aeolus-fleet/ui';
import { appSwitcherOf } from '@aeolus-fleet/common/rules';

/** The console's switcher in stories: the fleet Acme, with no apps list (argo's sign-in), so "Acme / Console" with no ▾. */
export const SWITCHER = appSwitcherOf({ list: undefined, fleet: { id: idSchema('fleet').parse('flt_01m5fcd917vwf30mx663fgc3z8'), name: 'Acme' }, app: 'console' });

/** The avatar menu in stories: argo's sign-in, this session, the System theme. */
export const AVATAR_MENU: AvatarMenuProps = {
  name: undefined,
  signedInAs: 'argo',
  session: 'Device · Mac · Chrome, since 08:02',
  theme: 'system',
  themes: THEMES,
  hasTheme: true,
  onThemeChange: () => undefined,
  shortcuts: [{ keys: ['⌘', 'K'], label: 'Search ships or jump to' }],
  helpUrl: 'https://github.com/ThomasHendrickx/aeolus-fleet',
  onSignOut: () => undefined,
  isSigningOut: false,
};
