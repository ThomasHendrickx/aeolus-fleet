import { Link2 } from 'lucide-react';

import type { ShownConnection } from '../../../../lib/shown-connection';
import { LoadingSkeleton, Button, InlineError } from '@aeolus-fleet/ui';
import { FailedScopesRead } from '../molecules/failed-scopes-read';
import { MissingScopes } from '../molecules/missing-scopes';

interface WatchPluginConnectionProps {
  /** The watch plugin as the web app's server reads it; undefined while it loads. */
  settings: ShownConnection | undefined;
  /** The read failed: shown with Try again. */
  loadError?: string;
  onRetry: () => Promise<unknown>;
  isConnecting: boolean;
  /** Why the last Connect failed, as the watch plugin or the fleet says it. */
  connectError?: string;
  /** The last Connect, or Grant missing scopes, succeeded. */
  hasConnected: boolean;
  onConnect: () => void;
}

/**
 * Settings, Watch plugin (design watch-connection): whether the watch plugin
 * is connected, and as which ship, and the one button that connects it. The
 * web app's server commissions its ship, watch-plugin, and hands its secret
 * to the watch plugin; the console never sees the secret. Shown only while
 * the watch plugin is on for the fleet: off, the browser learns nothing of it
 * (decision 0033).
 */
export function WatchPluginConnection({ settings, loadError, onRetry, isConnecting, connectError, hasConnected, onConnect }: WatchPluginConnectionProps) {
  if (loadError !== undefined) {
    return <InlineError title="Couldn’t read the watch plugin" description={loadError} onRetry={() => { void onRetry(); }} />;
  }
  if (settings === undefined) {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading the watch plugin" />;
  }
  if (settings.state === 'none') {
    return null;
  }
  return (
    <section aria-labelledby="settings-watch-plugin" data-testid="settings-watch-plugin" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <h2 id="settings-watch-plugin" className="text-body font-semibold">
        Watch plugin
      </h2>
      {settings.state === 'connected' ? (
        <>
          <p className="text-body" data-testid="settings-watch-plugin-state">
            Connected as <span className="font-mono">{settings.ship?.name}</span>{' '}
            <span className="font-mono text-muted-foreground">({settings.ship?.shipId})</span>
          </p>
          {settings.scopes.kind === 'failed' ? (
            <FailedScopesRead plugin="the watch plugin" shipName={settings.ship?.name ?? 'watch-plugin'} reason={settings.scopes.reason} onRetry={onRetry} />
          ) : (
            <MissingScopes
              plugin="the watch plugin"
              shipName={settings.ship?.name ?? 'watch-plugin'}
              missingScopes={settings.scopes.missingScopes}
              isGranting={isConnecting}
              hasGranted={hasConnected}
              {...(connectError === undefined ? {} : { grantError: connectError })}
              onGrant={onConnect}
              testId="settings-watch-plugin"
            />
          )}
        </>
      ) : (
        <>
          <p className="text-body" data-testid="settings-watch-plugin-state">
            Not connected. Connecting commissions the ship watch-plugin, with fleet read and alert, or gives it a new starting prompt, and hands its secret to
            the watch plugin. No one sees the secret.
          </p>
          <div>
            <Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={onConnect} data-testid="settings-watch-plugin-connect">
              Connect watch plugin
            </Button>
          </div>
          {connectError !== undefined && <InlineError title="Couldn’t connect the watch plugin" description={connectError} />}
        </>
      )}
    </section>
  );
}
