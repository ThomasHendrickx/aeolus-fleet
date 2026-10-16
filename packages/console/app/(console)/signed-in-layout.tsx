'use client';

import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { ConsoleFrame } from '../../components/organisms/console-frame';
import { ConsoleCommands } from '../../features/commands/organisms/console-commands';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { ConsoleGuide } from '../../features/guide/organisms/console-guide';
import { ConsoleNotices } from '../../features/notices/organisms/console-notices';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { ConsoleFrameContext, destinationOf } from '../../lib/console-frame';
import { useOpenInboxCount } from '../../lib/inbox';
import { useAttentionCount } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';

/**
 * The signed-in route layout's client part: the ConsoleFrame with the
 * navigation and its counts, the operator's account, Compose (sending as
 * argo, while the session may send) and the CommandPalette. Each page shows
 * its own ListPage or DetailPage inside, with what this hands it.
 */
export function SignedInLayout({ children }: { children: ReactNode }) {
  const now = useNow();
  const account = useAccountMenu(now);
  const access = useAccess();
  const inboxCount = useOpenInboxCount();
  const attentionCount = useAttentionCount();
  const pluginNav = usePluginNav();
  const active = destinationOf(usePathname());
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const compose = () => {
    setIsComposing(true);
  };

  return (
    <ConsoleFrameContext
      value={{
        account,
        onCompose: access.canSend ? compose : undefined,
        onSearch: () => {
          setIsSearching(true);
        },
        banner: (
          <>
            <ConsoleNotices />
            <ConsoleGuide />
          </>
        ),
      }}
    >
      <ConsoleFrame nav={{ active, inboxCount, attentionCount, ...pluginNav }} account={account}>
        {children}
      </ConsoleFrame>
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands isOpen={isSearching} onOpenChange={setIsSearching} onCompose={compose} />
    </ConsoleFrameContext>
  );
}
