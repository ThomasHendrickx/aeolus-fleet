'use client';

import { useSettingsItems } from '../hooks/use-settings-items';
import { AccountSettings } from '../ui/organisms/account-settings';
import { HelpSettings } from '../ui/organisms/help-settings';
import { NetworkSettingsRow } from '../ui/organisms/network-settings-row';
import { ThemeSettings } from '../ui/organisms/theme-settings';

/**
 * The sections Settings opens with for every sign-in (docs/design/app-navigation,
 * where the account menu's items go): on phone Network first, then Theme,
 * Help and, for an account Account names or argo allows, Your account.
 */
export function SettingsItems() {
  const items = useSettingsItems();
  return (
    <>
      {items.hasNetwork ? <NetworkSettingsRow /> : null}
      <ThemeSettings theme={items.theme} themes={items.themes} hasThemeSwitch={items.hasThemeSwitch} onThemeChange={items.onThemeChange} />
      <HelpSettings shortcuts={items.shortcuts} helpUrl={items.helpUrl} {...(items.onTakeTour === undefined ? {} : { onTakeTour: items.onTakeTour })} />
      {items.accountUrl === undefined && items.onSignInAsArgo === undefined ? null : (
        <AccountSettings
          {...(items.accountUrl === undefined ? {} : { accountUrl: items.accountUrl })}
          {...(items.onSignInAsArgo === undefined ? {} : { onSignInAsArgo: items.onSignInAsArgo })}
          isSigningInAsArgo={items.isSigningInAsArgo}
        />
      )}
    </>
  );
}
