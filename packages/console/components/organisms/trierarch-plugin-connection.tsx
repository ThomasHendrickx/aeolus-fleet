import { Link2, ShipWheel } from 'lucide-react';
import Link from 'next/link';

import type { TrierarchPluginSettings } from '../../lib/trierarch-plugin';
import { Button } from '../atoms/button';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';

interface TrierarchPluginConnectionProps {
  /** The trierarch plugin as the web app's server reads it; undefined while it loads. */
  settings: TrierarchPluginSettings | undefined;
  /** The read failed: shown with Try again. */
  loadError?: string;
  onRetry: () => void;
  isConnecting: boolean;
  /** Why the last Connect failed, as the trierarch plugin or the fleet says it. */
  connectError?: string;
  onConnect: () => void;
}

const WHAT_IT_DOES = 'Starts, restarts and stops sessions for crew requests on your machines. Without it, crew requests wait on Needs crew for you to crew by hand.';

/**
 * Settings, Trierarchs (canvas TpOffSettings; #245): whether the trierarch
 * plugin is set up, connected, and as which ship, and the one button that
 * connects it. The web app's server commissions its ship, trierarch-plugin,
 * and hands its secret to the trierarch plugin; the console never sees the
 * secret. Not set up (no AEOLUS_TRIERARCH_PLUGIN_URL, or off for this fleet)
 * is a normal state: it says what the plugin does and where to set it up.
 */
export function TrierarchPluginConnection({ settings, loadError, onRetry, isConnecting, connectError, onConnect }: TrierarchPluginConnectionProps) {
  if (loadError !== undefined) {
    return <InlineError title="Couldn’t read the trierarch plugin" description={loadError} onRetry={onRetry} />;
  }
  if (settings === undefined) {
    return <LoadingSkeleton variant="detail" rows={2} label="Loading the trierarch plugin" />;
  }
  const isSetUp = settings.configured && settings.connection.isEnabled;
  return (
    <section aria-labelledby="settings-trierarchs" data-testid="settings-trierarchs" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="settings-trierarchs" className="flex items-center gap-2 text-body font-semibold [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground">
        <ShipWheel aria-hidden />
        Trierarchs
      </h2>
      {!isSetUp ? (
        <>
          <p className="text-body" data-testid="settings-trierarchs-state">
            Not set up. {WHAT_IT_DOES}
          </p>
          <div>
            <Button size="sm" nativeButton={false} render={<Link href="/trierarchs" />} data-testid="settings-trierarchs-how">
              How to set it up
            </Button>
          </div>
        </>
      ) : settings.connection.state === 'connected' ? (
        <p className="text-body" data-testid="settings-trierarchs-state">
          Connected as <span className="font-mono">{settings.connection.ship?.name}</span>{' '}
          <span className="font-mono text-muted-foreground">({settings.connection.ship?.shipId})</span>
        </p>
      ) : (
        <>
          <p className="text-body" data-testid="settings-trierarchs-state">
            Not connected. Connecting commissions the ship trierarch-plugin, which reads and manages the fleet and assigns crew requests, or gives it a new
            starting prompt, and hands its secret to the trierarch plugin. No one sees the secret.
          </p>
          <div>
            <Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={onConnect} data-testid="settings-trierarchs-connect">
              Connect trierarch plugin
            </Button>
          </div>
          {connectError !== undefined && <InlineError variant="field" title="Couldn’t connect the trierarch plugin" description={connectError} />}
        </>
      )}
    </section>
  );
}
