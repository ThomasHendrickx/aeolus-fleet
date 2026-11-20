'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { ConsoleFrame } from '../../components/organisms/console-frame';
import { AccountRenewal } from '../../features/account-renewal/state/account-renewal';
import { ArgoSignIn } from '../../features/argo-sign-in/state/argo-sign-in';
import { ConsoleCommands } from '../../features/commands/state/console-commands';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { ConsoleGuide } from '../../features/guide/state/console-guide';
import { ConsoleNotices } from '../../features/notices/organisms/console-notices';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useAppSwitcher } from '../../lib/app-switcher';
import { ConsoleFrameContext, destinationOf } from '../../lib/console-frame';
import { ARRIVED_PARAMETER } from '../../lib/fleet-switch';
import { useOpenInboxCount } from '../../lib/inbox';
import { useStuckCount } from '../../lib/fleet-health';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';

/**
 * The signed-in route layout's client part: the ConsoleFrame with the
 * navigation and its counts, the operator's account, Compose (sending as
 * argo, while the session may send, also from ?compose=new) and the CommandPalette. Each page shows
 * its own ListPage or DetailPage inside, with what this hands it.
 */
export function SignedInLayout({ children }: { children: ReactNode }) {
  const now = useNow();
  const account = useAccountMenu(now);
  const { switcher, switcherState, isSignInExpired } = useAppSwitcher();
  const access = useAccess();
  const inboxCount = useOpenInboxCount();
  const stuckCount = useStuckCount().data?.count;
  const pluginNav = usePluginNav();
  const active = destinationOf(usePathname());
  const [isComposing, setIsComposing] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Another app's palette opens Compose with ?compose=new (header design H4); it opens only while the session may send.
  const isComposeAsked = searchParams.get('compose') === 'new' && access.canSend;
  const [isSearching, setIsSearching] = useState(false);
  const compose = () => {
    setIsComposing(true);
  };
  // Another fleet opened from the panel: once the bar names it, the page says so (docs/design/app-navigation, section 4).
  const arrivedIn = searchParams.get(ARRIVED_PARAMETER);
  const arrival = switcher !== undefined && arrivedIn !== null && arrivedIn === switcher.fleet.id ? { appLabel: switcher.appLabel, fleetName: switcher.fleet.name } : undefined;
  const hasArrived = arrival !== undefined;
  // Focus goes back to the launcher on arrival: the page is an outside system to it.
  useEffect(() => {
    if (hasArrived) {
      [...document.querySelectorAll<HTMLElement>('[data-testid="app-switcher-launcher"]')].find((launcher) => launcher.getClientRects().length > 0)?.focus();
    }
  }, [hasArrived]);

  return (
    <ConsoleFrameContext
      value={{
        switcher,
        switcherState,
        ...(arrival === undefined ? {} : { arrival }),
        account: { ...account, isSignInExpired },
        onCompose: access.canSend ? compose : undefined,
        onSearch: () => {
          setIsSearching(true);
        },
        banner: (
          <>
            <AccountRenewal />
            <ArgoSignIn />
            <ConsoleNotices />
            <ConsoleGuide />
          </>
        ),
      }}
    >
      <ConsoleFrame nav={{ active, inboxCount, stuckCount, needsCrewCount: pluginNav.needsCrewCount, hasSquadrons: pluginNav.hasSquadrons, hasTrierarchs: pluginNav.hasTrierarchs, trierarchsCount: pluginNav.trierarchsCount, hasNetwork: pluginNav.hasNetwork }}>
        {children}
      </ConsoleFrame>
      <ComposeMessage
        isOpen={isComposing || isComposeAsked}
        onOpenChange={(isOpen) => {
          setIsComposing(isOpen);
          if (!isOpen && isComposeAsked) {
            const kept = new URLSearchParams(searchParams);
            kept.delete('compose');
            router.replace(kept.size === 0 ? pathname : `${pathname}?${kept.toString()}`);
          }
        }}
      />
      <ConsoleCommands isOpen={isSearching} onOpenChange={setIsSearching} onCompose={compose} switcher={switcher} />
    </ConsoleFrameContext>
  );
}
