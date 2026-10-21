import { Globe, Link2 } from 'lucide-react';

import type { ShownConnection } from '../../../../lib/shown-connection';
import { Button } from '@aeolus-fleet/common/header';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';

interface GatewayConnectionProps {
  /** The gateway as the web app's server reads it; undefined while it loads. */
  settings: ShownConnection | undefined;
  /** The read failed: shown with Try again. */
  loadError?: string;
  onRetry: () => void;
  isConnecting: boolean;
  /** Why the last Connect failed, as the gateway or the fleet says it. */
  connectError?: string;
  onConnect: () => void;
}

/**
 * Settings, Gateway: whether the gateway is connected, and as which ship, and
 * the one button that connects it. The web app's server commissions its
 * ship, gateway, and hands its secret to the gateway; the console never sees
 * the secret. The gateway serves its own pages (decision 0043). Shown only
 * while the gateway is on for the fleet: off, the browser learns nothing of
 * it (decision 0033).
 */
export function GatewayConnection({ settings, loadError, onRetry, isConnecting, connectError, onConnect }: GatewayConnectionProps) {
  if (loadError !== undefined) {
    return <InlineError title="Couldn’t read the gateway" description={loadError} onRetry={onRetry} />;
  }
  if (settings === undefined) {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading the gateway" />;
  }
  if (settings.state === 'none') {
    return null;
  }
  return (
    <section aria-labelledby="settings-gateway" data-testid="settings-gateway" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="settings-gateway" className="flex items-center gap-2 text-body font-semibold [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground">
        <Globe aria-hidden />
        Gateway
      </h2>
      {settings.state === 'connected' ? (
        <p className="text-body" data-testid="settings-gateway-state">
          Connected as <span className="font-mono">{settings.ship?.name}</span>{' '}
          <span className="font-mono text-muted-foreground">({settings.ship?.shipId})</span>. It commissions an app ship for each outside party you approve.
        </p>
      ) : (
        <>
          <p className="text-body" data-testid="settings-gateway-state">
            Not connected. Connecting commissions the ship gateway, which reads the fleet and commissions an app ship for each outside party you approve, or
            gives it a new starting prompt, and hands its secret to the gateway. No one sees the secret.
          </p>
          <div>
            <Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={onConnect} data-testid="settings-gateway-connect">
              Connect gateway
            </Button>
          </div>
          {connectError !== undefined && <InlineError variant="field" title="Couldn’t connect the gateway" description={connectError} />}
        </>
      )}
    </section>
  );
}
