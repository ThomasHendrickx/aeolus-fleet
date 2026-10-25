import { CircleCheck, KeyRound, TriangleAlert } from 'lucide-react';

import { Button } from '@aeolus-fleet/common/header';
import { InlineError } from '../../../../components/molecules/inline-error';

interface MissingScopesProps {
  /** The plugin in words, such as "the trierarch plugin". */
  plugin: string;
  /** The plugin's ship by name. */
  shipName: string;
  /** The scopes the plugin lists that its ship lacks; with none it shows nothing, or the success line after a grant. */
  missingScopes: readonly string[];
  isGranting: boolean;
  /** The last grant succeeded: with no scope missing, it says the ship holds every one. */
  hasGranted: boolean;
  /** Why the last grant failed, as the plugin or the fleet says it. */
  grantError?: string;
  onGrant: () => void;
  /** The section's test id, such as settings-trierarchs, which its own extend. */
  testId: string;
}

/**
 * A connected plugin's ship that lacks a scope its plugin lists (#1226), as
 * a ship commissioned before its plugin listed it does: Settings names the
 * scopes and offers the one action that grants them, a connect, which grants
 * a connected ship the scopes it lacks. Calls that need them fail until then.
 */
export function MissingScopes({ plugin, shipName, missingScopes, isGranting, hasGranted, grantError, onGrant, testId }: MissingScopesProps) {
  if (missingScopes.length === 0) {
    return hasGranted ? (
      <p role="status" className="flex items-center gap-2 text-body text-tone-ok-fg [&_svg]:size-(--size-icon) [&_svg]:shrink-0" data-testid={`${testId}-scopes-granted`}>
        <CircleCheck aria-hidden />
        <span>
          <span className="font-mono">{shipName}</span> holds every scope {plugin} lists.
        </span>
      </p>
    ) : null;
  }
  const them = missingScopes.length === 1 ? 'it' : 'them';
  return (
    <div className="flex flex-col gap-3 rounded-md border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2" data-testid={`${testId}-missing-scopes`}>
      <p className="flex items-start gap-2 text-body text-tone-waiting-fg [&_svg]:mt-0.5 [&_svg]:size-(--size-icon) [&_svg]:shrink-0">
        <TriangleAlert aria-hidden />
        <span>
          <span className="font-mono">{shipName}</span> lacks {missingScopes.length === 1 ? 'a scope' : 'scopes'} {plugin} lists:{' '}
          <span className="font-mono">{missingScopes.join(', ')}</span>. What needs {them} fails until you grant {them}.
        </span>
      </p>
      <div>
        <Button size="sm" icon={<KeyRound aria-hidden />} isLoading={isGranting} onClick={onGrant} data-testid={`${testId}-grant-scopes`}>
          {isGranting ? 'Granting missing scopes…' : 'Grant missing scopes'}
        </Button>
      </div>
      {grantError !== undefined && <InlineError title="Couldn’t grant the missing scopes" description={`${grantError}. Nothing changed: try again.`} />}
    </div>
  );
}
