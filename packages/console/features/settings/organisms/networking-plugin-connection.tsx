import { Link2, Network } from 'lucide-react';
import Link from 'next/link';

import type { ShownConnection } from '../../../lib/shown-connection';
import { Button } from '../../../components/atoms/button';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';

interface NetworkingPluginConnectionProps {
  /** The networking plugin as the web app's server reads it; undefined while it loads. */
  settings: ShownConnection | undefined;
  /** The read failed: shown with Try again. */
  loadError?: string;
  onRetry: () => void;
  isConnecting: boolean;
  /** Why the last Connect failed, as the networking plugin or the fleet says it. */
  connectError?: string;
  onConnect: () => void;
}

/**
 * Settings, Network (#260; decision 0036): whether the networking plugin is
 * connected, and as which ship, and the one button that connects it. The web
 * app's server commissions its ship, networking-plugin, and hands its secret
 * to the plugin; the console never sees the secret. Connected, it leads to
 * Network, where argo edits the rules. Shown only while the plugin is on for
 * the fleet: off, the browser learns nothing of it (decision 0033).
 */
export function NetworkingPluginConnection({ settings, loadError, onRetry, isConnecting, connectError, onConnect }: NetworkingPluginConnectionProps) {
  if (loadError !== undefined) {
    return <InlineError title="Couldn’t read the networking plugin" description={loadError} onRetry={onRetry} />;
  }
  if (settings === undefined) {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading the networking plugin" />;
  }
  if (settings.state === 'none') {
    return null;
  }
  return (
    <section aria-labelledby="settings-network" data-testid="settings-network" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="settings-network" className="flex items-center gap-2 text-body font-semibold [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground">
        <Network aria-hidden />
        Network
      </h2>
      {settings.state === 'connected' ? (
        <>
          <p className="text-body" data-testid="settings-network-state">
            Connected as <span className="font-mono">{settings.ship?.name}</span>{' '}
            <span className="font-mono text-muted-foreground">({settings.ship?.shipId})</span>. It supplies the rules you set on Network to the fleet.
          </p>
          <div>
            <Button size="sm" nativeButton={false} render={<Link href="/network" />} data-testid="settings-network-open">
              Open Network
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body" data-testid="settings-network-state">
            Not connected. Connecting commissions the ship networking-plugin, which reads the fleet and alone sets who may message whom, or gives it a new
            starting prompt, and hands its secret to the networking plugin. No one sees the secret. Until you set rules, every ship may message every ship.
          </p>
          <div>
            <Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={onConnect} data-testid="settings-network-connect">
              Connect networking plugin
            </Button>
          </div>
          {connectError !== undefined && <InlineError variant="field" title="Couldn’t connect the networking plugin" description={connectError} />}
        </>
      )}
    </section>
  );
}
