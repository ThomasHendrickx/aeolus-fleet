import { idSchema } from '@aeolus-fleet/common';
import type { AvatarMenuProps } from '@aeolus-fleet/ui';
import { appSwitcherOf } from '@aeolus-fleet/common/rules';

/** The console's switcher in stories: the fleet Acme, with no apps list (argo's sign-in), so Console alone in Acme. */
export const SWITCHER = appSwitcherOf({ list: undefined, fleet: { id: idSchema('fleet').parse('flt_01m5fcd917vwf30mx663fgc3z8'), name: 'Acme' }, app: 'console' });

/** The account panel in stories: argo's sign-in for Console in Acme, this session, and Sign out (docs/design/app-navigation). */
export const AVATAR_MENU: AvatarMenuProps = {
  name: undefined,
  signedInAs: 'argo',
  signedInFor: 'Console in Acme',
  session: 'Device · Mac · Chrome, since 08:02',
  onSignOut: () => undefined,
  isSigningOut: false,
};
