'use client';

import { OwnSignInSection } from '../../../features/settings/state/own-sign-in-section';
import { SettingsItems } from '../../../features/settings/state/settings-items';
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
import { useConnectTrierarchPlugin, useTrierarchPluginSettings } from '../../../lib/trierarch-plugin';
import { useConnectWatchPlugin, useWatchPluginSettings } from '../../../lib/watch-plugin';

/**
 * Settings, for every sign-in (docs/design/app-navigation, where the account
 * menu's items go): first the theme, help and the account's own pages; then,
 * for a session that manages the fleet, how the installation runs: where the console
 * signs argo in itself, argo's email and password; with squadrons,
 * connecting it, and once connected, the repositories it reads; without,
 * nothing of squadrons. Whenever Settings is offered, the trierarch plugin:
 * not set up, connecting it, or connected. With the gateway on for the
 * fleet, connecting it, or the ship it is connected as; the same for the
 * watch plugin, after the gateway (design watch-connection).
 */
export default function SettingsPage() {
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const pluginNav = usePluginNav();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  return (
    <ListPage
      {...frame}
      title="Settings"
      description={pluginNav.hasInstallationSettings ? 'How this console looks for you, and how this installation runs.' : 'How this console looks for you.'}
      live={liveFleet.live}
    >
      <SettingsItems />
      {pluginNav.hasInstallationSettings ? <InstallationSettings /> : null}
    </ListPage>
  );
}

/**
 * How the installation runs, for a session that manages the fleet, each
 * section under its own rule.
 */
function InstallationSettings() {
  const now = useNow();
  const hasSquadrons = useHasSquadrons();
  const settings = useSquadronsSettings();
  const connect = useConnectSquadrons();
  const trierarchPlugin = useTrierarchPluginSettings();
  const connectTrierarchPlugin = useConnectTrierarchPlugin();
  const gateway = useGatewaySettings();
  const connectGateway = useConnectGateway();
  const watchPlugin = useWatchPluginSettings();
  const connectWatchPlugin = useConnectWatchPlugin();
  const connection = useSquadronsConnection();
  const repositories = useRepositories();
  const catalogue = useCatalogue();
  const addRepository = useAddRepository();
  const removeRepository = useRemoveRepository();
  const refreshCatalogue = useRefreshCatalogue();
  const hasOwnSignIn = useHasOwnSignIn();
  return (
    <>
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
    </>
  );
}
