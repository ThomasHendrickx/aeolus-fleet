import { InlineError } from '../../../../components/molecules/inline-error';

interface FailedScopesReadProps {
  /** The plugin in words, such as "the trierarch plugin". */
  plugin: string;
  /** The plugin's ship by name. */
  shipName: string;
  /** Why the read failed, as the fleet says it. */
  reason: string;
  isRetrying: boolean;
  onRetry: () => void;
}

/**
 * A connected plugin's ship whose scopes the fleet did not read (#1259):
 * Settings says the scopes are unknown and offers Try again, never nothing
 * missing, since a lack hidden here fails the plugin's calls elsewhere.
 */
export function FailedScopesRead({ plugin, shipName, reason, isRetrying, onRetry }: FailedScopesReadProps) {
  return (
    <InlineError
      title={`Couldn’t read the scopes of ${shipName}`}
      description={`${reason}. Nothing changed. Whether ${shipName} lacks a scope ${plugin} lists shows once the read succeeds.`}
      onRetry={onRetry}
      isRetrying={isRetrying}
    />
  );
}
