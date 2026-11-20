import { ArrowUpRight, BellRing, CircleUserRound, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';

import { SETTINGS_ROW, SettingsRows, SettingsSection } from '../molecules/settings-section';

interface AccountSettingsProps {
  /** The account's address in Account, from the apps list: set, its own pages show (H8). */
  accountUrl?: string;
  /** Signs the account in as argo; unset while the apps list does not allow it here (A7). */
  onSignInAsArgo?: () => void;
  isSigningInAsArgo: boolean;
}

/** The account's own pages in Account, from its address there. */
function accountPagesOf(accountUrl: string) {
  return [
    { key: 'account', label: 'Your account', href: accountUrl, Icon: CircleUserRound },
    { key: 'rights', label: 'Your rights', href: `${accountUrl}/rights`, Icon: ShieldCheck },
    { key: 'updates', label: 'Email updates', href: `${accountUrl}/updates`, Icon: BellRing },
  ];
}

/**
 * Settings, Your account (docs/design/app-navigation, where the account
 * menu's items go): the account's own pages, which open in Account, then
 * Sign in as argo last, which says "Signing in as argo" with a busy icon and
 * waits while it works.
 */
export function AccountSettings({ accountUrl, onSignInAsArgo, isSigningInAsArgo }: AccountSettingsProps) {
  return (
    <SettingsSection id="settings-your-account" title="Your account" {...(accountUrl === undefined ? {} : { line: 'These pages open in Account.' })}>
      <SettingsRows>
        {accountUrl === undefined
          ? null
          : accountPagesOf(accountUrl).map(({ key, label, href, Icon }) => (
              <li key={key}>
                <a href={href} data-testid={`settings-${key}`} className={SETTINGS_ROW}>
                  <Icon aria-hidden />
                  <span className="grow">{label}</span>
                  <ArrowUpRight aria-hidden />
                </a>
              </li>
            ))}
        {onSignInAsArgo === undefined ? null : (
          <li>
            <button type="button" data-testid="settings-sign-in-as-argo" disabled={isSigningInAsArgo} onClick={onSignInAsArgo} className={SETTINGS_ROW}>
              {isSigningInAsArgo ? (
                <LoaderCircle aria-hidden data-testid="settings-sign-in-as-argo-spinner" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <KeyRound aria-hidden />
              )}
              {isSigningInAsArgo ? 'Signing in as argo' : 'Sign in as argo'}
            </button>
          </li>
        )}
      </SettingsRows>
    </SettingsSection>
  );
}
