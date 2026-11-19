'use client';

import { LoadingSkeleton } from '@aeolus-fleet/ui';
import { useQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';

import { OwnSignInSection } from '../../../features/settings/state/own-sign-in-section';
import { GatewayConnection } from '../../../features/settings/ui/organisms/gateway-connection';
import { SquadronsConnection } from '../../../features/settings/ui/organisms/squadrons-connection';
import { TemplateRepositories } from '../../../features/settings/ui/organisms/template-repositories';
import { TrierarchPluginConnection } from '../../../features/settings/ui/organisms/trierarch-plugin-connection';
import { WatchPluginConnection } from '../../../features/settings/ui/organisms/watch-plugin-connection';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useConnectGateway, useGatewaySettings } from '../../../lib/gateway';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useHasOwnSignIn } from '../../../lib/own-sign-in';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useConnectSquadrons, useSquadronsConnection, useSquadronsSettings, useHasSquadrons } from '../../../lib/squadrons';
import { useAddRepository, useCatalogue, useRefreshCatalogue, useRemoveRepository, useRepositories } from '../../../lib/squadrons-api';
import { usePluginNav } from '../../../lib/plugin-nav';
import { useTRPC } from '../../../lib/trpc';
import { useConnectTrierarchPlugin, useTrierarchPluginSettings } from '../../../lib/trierarch-plugin';
import { useConnectWatchPlugin, useWatchPluginSettings } from '../../../lib/watch-plugin';

/**
 * Settings for sessions with permission to manage the fleet: where the console
 * signs argo in itself, argo's email and password; with squadrons,
 * connecting it, and once connected, the repositories it reads; without,
 * nothing of squadrons. Whenever Settings is offered, the trierarch plugin:
 * not set up, connecting it, or connected. With the gateway on for the
 * fleet, connecting it, or the ship it is connected as; the same for the
 * watch plugin, after the gateway (design watch-connection).
 */
export default function SettingsPage() {
  const trpc = useTRPC();
  const session = useQuery(trpc.console.session.queryOptions());
  const now = useNow();
  const frame = useConsoleFrame();
  const hasSquadrons = useHasSquadrons();
  const attention = useNeedsAttention();
  const settings = useSquadronsSettings();
  const connect = useConnectSquadrons();
  const trierarchPlugin = useTrierarchPluginSettings();
  const connectTrierarchPlugin = useConnectTrierarchPlugin();
  const gateway = useGatewaySettings();
  const connectGateway = useConnectGateway();
  const watchPlugin = useWatchPluginSettings();
  const connectWatchPlugin = useConnectWatchPlugin();
  const liveFleet = useLiveFleet();
  const connection = useSquadronsConnection();
  const repositories = useRepositories();
  const catalogue = useCatalogue();
  const addRepository = useAddRepository();
  const removeRepository = useRemoveRepository();
  const refreshCatalogue = useRefreshCatalogue();
  const pluginNav = usePluginNav();
  const hasOwnSignIn = useHasOwnSignIn();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  if (!pluginNav.hasSettings) {
    if (session.isPending || settings.isPending || trierarchPlugin.isPending || gateway.isPending || watchPlugin.isPending) {
      return <LoadingSkeleton variant="list" label="Loading Settings" />;
    }
    notFound();
  }

  return (
    <ListPage
      {...frame}
      title="Settings"
      description="How this installation runs. You can use these settings as argo, the operator, or as an account owner with permission to manage the fleet."
      live={liveFleet.live}
    >
      {hasOwnSignIn && <OwnSignInSection />}
      {hasSquadrons && (
        <SquadronsConnection
          settings={settings.data}
          loadError={settings.isError ? settings.error.message : undefined}
          onRetry={() => settings.refetch()}
          isConnecting={connect.isPending}
          connectError={connect.isError ? connect.error.message : undefined}
          hasConnected={connect.isSuccess}
          onConnect={() => {
            connect.mutate();
          }}
        />
      )}
      <TrierarchPluginConnection
        settings={trierarchPlugin.data}
        loadError={trierarchPlugin.isError ? trierarchPlugin.error.message : undefined}
        onRetry={() => trierarchPlugin.refetch()}
        isConnecting={connectTrierarchPlugin.isPending}
        connectError={connectTrierarchPlugin.isError ? connectTrierarchPlugin.error.message : undefined}
        hasConnected={connectTrierarchPlugin.isSuccess}
        onConnect={() => {
          connectTrierarchPlugin.mutate();
        }}
      />
      <GatewayConnection
        settings={gateway.data}
        loadError={gateway.isError ? gateway.error.message : undefined}
        onRetry={() => gateway.refetch()}
        isConnecting={connectGateway.isPending}
        connectError={connectGateway.isError ? connectGateway.error.message : undefined}
        hasConnected={connectGateway.isSuccess}
        onConnect={() => {
          connectGateway.mutate();
        }}
      />
      <WatchPluginConnection
        settings={watchPlugin.data}
        loadError={watchPlugin.isError ? watchPlugin.error.message : undefined}
        onRetry={() => watchPlugin.refetch()}
        isConnecting={connectWatchPlugin.isPending}
        connectError={connectWatchPlugin.isError ? connectWatchPlugin.error.message : undefined}
        hasConnected={connectWatchPlugin.isSuccess}
        onConnect={() => {
          connectWatchPlugin.mutate();
        }}
      />
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
    </ListPage>
  );
}
