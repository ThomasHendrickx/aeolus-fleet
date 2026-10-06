'use client';

import { useState } from 'react';

import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { ConsoleGuide } from '../../components/organisms/console-guide';
import { ConsoleNotices } from '../../components/organisms/console-notices';
import { SquadronsConnection } from '../../components/organisms/squadrons-connection';
import { TemplateRepositories } from '../../components/organisms/template-repositories';
import { ListLayout } from '../../components/templates/list-layout';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useOpenInboxCount } from '../../lib/inbox';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useLiveFleet } from '../../lib/live-fleet';
import { useConnectSquadrons, useSquadronsConnection, useSquadronsSettings, useHasSquadrons } from '../../lib/squadrons';
import { useAddRepository, useCatalogue, useRefreshCatalogue, useRemoveRepository, useRepositories } from '../../lib/squadrons-api';

/** Settings: the installation's own settings, argo's alone: with squadrons, connecting it, and once connected, the repositories it reads; without, nothing of squadrons. */
export default function SettingsPage() {
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const settings = useSquadronsSettings();
  const connect = useConnectSquadrons();
  const liveFleet = useLiveFleet();
  const connection = useSquadronsConnection();
  const repositories = useRepositories();
  const catalogue = useCatalogue();
  const addRepository = useAddRepository();
  const removeRepository = useRemoveRepository();
  const refreshCatalogue = useRefreshCatalogue();
  const access = useAccess();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  return (
    <ListLayout
      title="Settings"
      description="How this installation runs. Only argo, the operator, sees this page."
      live={liveFleet.live}
      nav={{ active: 'settings', inboxCount, attentionCount, hasSquadrons, hasSettings: hasSquadrons && access.canManage }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
    >
      {hasSquadrons && (
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
      )}
      {connection === 'connected' && (
        <TemplateRepositories
          repositories={repositories.data ?? []}
          {...(catalogue.data === undefined ? {} : { catalogue: catalogue.data })}
          state={repositories.isError ? 'error' : repositories.data ? 'ready' : 'loading'}
          error={repositories.error?.message}
          onRetry={() => {
            void repositories.refetch();
          }}
          isAdding={addRepository.isPending}
          addError={addRepository.error?.message}
          onAdd={(repository, done) => {
            addRepository.mutate(repository, { onSuccess: done });
          }}
          isRemoving={removeRepository.isPending}
          removeError={removeRepository.error?.message}
          onRemove={(name, done) => {
            removeRepository.mutate(name, { onSuccess: done });
          }}
          onRemoveClosed={() => {
            removeRepository.reset();
          }}
          isRefreshing={refreshCatalogue.isPending}
          refreshError={refreshCatalogue.error?.message}
          onRefresh={() => {
            refreshCatalogue.mutate();
          }}
          now={now}
        />
      )}
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
