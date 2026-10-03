'use client';

import { useState } from 'react';

import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { SquadronsConnection } from '../../components/organisms/squadrons-connection';
import { ListLayout } from '../../components/templates/list-layout';
import { useAccountMenu } from '../../lib/account';
import { useOpenInboxCount } from '../../lib/inbox';
import { useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useLiveFleet } from '../../lib/live-fleet';
import { useConnectSquadrons, useSquadronsSettings, useHasSquadrons } from '../../lib/squadrons';

/** Settings: the installation's own settings, argo's alone. So far, connecting squadrons. */
export default function SettingsPage() {
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const settings = useSquadronsSettings();
  const connect = useConnectSquadrons();
  const liveFleet = useLiveFleet();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  return (
    <ListLayout
      title="Settings"
      description="How this installation runs. Only argo, the operator, sees this page."
      live={liveFleet.live}
      nav={{ active: 'settings', inboxCount, attentionCount: attention.data?.length , hasSquadrons }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
      <SquadronsConnection
        settings={settings.data}
        loadError={settings.isError ? settings.error.message : undefined}
        onRetry={() => {
          void settings.refetch();
        }}
        isConnecting={connect.isPending}
        connectError={connect.isError ? connect.error.message : undefined}
        onConnect={() => {
          connect.mutate();
        }}
      />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}
