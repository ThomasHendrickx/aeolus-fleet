import { useState } from 'react';

import { InlineError } from '@aeolus-fleet/ui';

interface FailedScopesReadProps {
  /** The plugin in words, such as "the trierarch plugin". */
  plugin: string;
  /** The plugin's ship by name. */
  shipName: string;
  /** Why the read failed, as the fleet says it. */
  reason: string;
  /** Reads the section again; Try again shows pending until it settles. */
  onRetry: () => Promise<unknown>;
}

/**
 * A connected plugin's ship whose scopes the fleet did not read (#1259):
 * Settings says the scopes are unknown and offers Try again, never nothing
 * missing, since a lack hidden here fails the plugin's calls elsewhere.
 */
export function FailedScopesRead({ plugin, shipName, reason, onRetry }: FailedScopesReadProps) {
  // Pending comes from this click only: a background refetch shows nothing.
  const [isRetrying, setIsRetrying] = useState(false);
  return (
    <InlineError
      title={`Couldn’t read the scopes of ${shipName}`}
      description={`${reason}. Nothing changed. Whether ${shipName} lacks a scope ${plugin} lists shows once the read succeeds.`}
      onRetry={() => {
        setIsRetrying(true);
        void onRetry().finally(() => {
          setIsRetrying(false);
        });
      }}
      isRetrying={isRetrying}
    />
  );
}
