'use client';

import { NetworkingPluginConnection } from '../../../features/settings/organisms/networking-plugin-connection';
import { SquadronsConnection } from '../../../features/settings/organisms/squadrons-connection';
import { TemplateRepositories } from '../../../features/settings/organisms/template-repositories';
import { TrierarchPluginConnection } from '../../../features/settings/organisms/trierarch-plugin-connection';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useConnectSquadrons, useSquadronsConnection, useSquadronsSettings, useHasSquadrons } from '../../../lib/squadrons';
import { useAddRepository, useCatalogue, useRefreshCatalogue, useRemoveRepository, useRepositories } from '../../../lib/squadrons-api';
import { useConnectNetworkingPlugin, useNetworkingPluginSettings } from '../../../lib/networking-plugin';
import { usePluginNav } from '../../../lib/plugin-nav';
import { useConnectTrierarchPlugin, useTrierarchPluginSettings } from '../../../lib/trierarch-plugin';

/**
 * Settings: the installation's own settings, argo's alone: with squadrons,
 * connecting it, and once connected, the repositories it reads; without,
 * nothing of squadrons. Whenever Settings is offered, the trierarch plugin:
 * not set up, connecting it, or connected. With the networking plugin on for
 * the fleet, connecting it, and once connected, the way to Network.
 */
export default function SettingsPage() {
  const now = useNow();
  const frame = useConsoleFrame();
  const hasSquadrons = useHasSquadrons();
  const attention = useNeedsAttention();
  const settings = useSquadronsSettings();
  const connect = useConnectSquadrons();
  const trierarchPlugin = useTrierarchPluginSettings();
  const connectTrierarchPlugin = useConnectTrierarchPlugin();
  const networkingPlugin = useNetworkingPluginSettings();
  const connectNetworkingPlugin = useConnectNetworkingPlugin();
  const liveFleet = useLiveFleet();
  const connection = useSquadronsConnection();
  const repositories = useRepositories();
  const catalogue = useCatalogue();
  const addRepository = useAddRepository();
  const removeRepository = useRemoveRepository();
  const refreshCatalogue = useRefreshCatalogue();
  const pluginNav = usePluginNav();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  return (
    <ListPage
      {...frame}
      title="Settings"
      description="How this installation runs. Only argo, the operator, sees this page."
      live={liveFleet.live}
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
      {pluginNav.hasSettings && (
        <TrierarchPluginConnection
          settings={trierarchPlugin.data}
          loadError={trierarchPlugin.isError ? trierarchPlugin.error.message : undefined}
          onRetry={() => {
            void trierarchPlugin.refetch();
          }}
          isConnecting={connectTrierarchPlugin.isPending}
          connectError={connectTrierarchPlugin.isError ? connectTrierarchPlugin.error.message : undefined}
          onConnect={() => {
            connectTrierarchPlugin.mutate();
          }}
        />
      )}
      {pluginNav.hasSettings && (
        <NetworkingPluginConnection
          settings={networkingPlugin.data}
          loadError={networkingPlugin.isError ? networkingPlugin.error.message : undefined}
          onRetry={() => {
            void networkingPlugin.refetch();
          }}
          isConnecting={connectNetworkingPlugin.isPending}
          connectError={connectNetworkingPlugin.isError ? connectNetworkingPlugin.error.message : undefined}
          onConnect={() => {
            connectNetworkingPlugin.mutate();
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
    </ListPage>
  );
}
