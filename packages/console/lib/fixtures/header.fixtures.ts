import { accountIdSchema, idSchema } from '@aeolus-fleet/common';
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

const AEOLUS = idSchema('fleet').parse('flt_01m5fcd917vwf30mx663fgc3z8');
const HARBOUR = idSchema('fleet').parse('flt_01m5fcd917vwf30mx663fgc3z9');

/** An account's switcher in stories: Console, Gateway and Account in Aeolus, and the fleet Harbour too (docs/design/app-navigation). */
export const ACCOUNT_SWITCHER = appSwitcherOf({
  list: {
    account: { id: accountIdSchema.parse('acc-tess'), email: 'tess@acme.example' },
    apps: [{ app: 'account', url: 'https://account.acme.example/account' }],
    fleets: [
      { id: AEOLUS, name: 'Aeolus', argo: true, apps: [{ app: 'console', url: 'https://console.acme.example' }, { app: 'gateway', url: 'https://gateway.acme.example' }] },
      { id: HARBOUR, name: 'Harbour', argo: false, apps: [{ app: 'console', url: 'https://console.acme.example' }] },
    ],
  },
  fleet: { id: AEOLUS, name: 'Aeolus' },
  app: 'console',
});

/** argo's, the viewer's or a single-app installation's switcher in stories: Console alone in Aeolus. */
export const AEOLUS_SWITCHER = appSwitcherOf({ list: undefined, fleet: { id: AEOLUS, name: 'Aeolus' }, app: 'console' });

/** The account panel of an account, Tess Hale, in stories. */
export const ACCOUNT_MENU: AvatarMenuProps = { name: 'Tess Hale', signedInAs: 'account', onSignOut: () => undefined, isSigningOut: false };

/** The account panel of argo's sign-in for Console in Aeolus, in stories. */
export const ARGO_MENU: AvatarMenuProps = { ...AVATAR_MENU, signedInFor: 'Console in Aeolus' };

/** The account panel of the viewer's sign-in for Console in Aeolus, in stories. */
export const VIEWER_MENU: AvatarMenuProps = { ...AVATAR_MENU, signedInAs: 'viewer', signedInFor: 'Console in Aeolus' };
