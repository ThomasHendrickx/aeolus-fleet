import { Link2 } from 'lucide-react';

import type { SquadronsSettings } from '../../lib/squadrons';
import { Button } from '../atoms/button';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';

interface SquadronsConnectionProps {
  /** Squadrons as the web app's server reads it; undefined while it loads. */
  settings: SquadronsSettings | undefined;
  /** The read failed: shown with Try again. */
  loadError?: string;
  onRetry: () => void;
  isConnecting: boolean;
  /** Why the last Connect squadrons failed, as squadrons or the fleet says it. */
  connectError?: string;
  onConnect: () => void;
}

/**
 * Settings, Squadrons: whether squadrons is connected, as which ship, and the
 * one button that connects it. The web app's server commissions the management
 * ship and hands its secret to squadrons; the console never sees the secret.
 * Without squadrons it shows nothing: no trace of squadrons in the console.
 */
export function SquadronsConnection({ settings, loadError, onRetry, isConnecting, connectError, onConnect }: SquadronsConnectionProps) {
  if (loadError !== undefined) {
    return <InlineError title="Couldn’t read squadrons" description={loadError} onRetry={onRetry} />;
  }
  if (settings === undefined) {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading squadrons" />;
  }
  if (!settings.configured) {
    return null;
  }
  return (
    <section aria-labelledby="settings-squadrons" data-testid="settings-squadrons" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="settings-squadrons" className="text-body font-semibold">
        Squadrons
      </h2>
      {settings.connection.state === 'connected' ? (
        <p className="text-body" data-testid="settings-squadrons-state">
          Connected as <span className="font-mono">{settings.connection.ship?.name}</span>{' '}
          <span className="font-mono text-muted-foreground">({settings.connection.ship?.shipId})</span>
        </p>
      ) : (
        <>
          <p className="text-body" data-testid="settings-squadrons-state">
            Not connected. Connecting commissions the ship squadrons, with fleet read and manage, or gives it a new starting prompt, and hands its secret to squadrons. No one sees the secret.
          </p>
          <div>
            <Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={onConnect} data-testid="settings-squadrons-connect">
              Connect squadrons
            </Button>
          </div>
          {connectError !== undefined && <InlineError variant="field" title="Couldn’t connect squadrons" description={connectError} />}
        </>
      )}
    </section>
  );
}
