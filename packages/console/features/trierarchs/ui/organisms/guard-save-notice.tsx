import { InlineError } from '@aeolus-fleet/ui';
import type { GuardSaveError } from '../../services/guard-configuration';

/** A refused or unconfirmed change is explained beside the control that sent it. */
export function GuardSaveNotice({ error, isReading, onReadAgain }: {
  error?: GuardSaveError;
  isReading: boolean;
  onReadAgain: () => void;
}) {
  if (error === undefined) return null;
  return (
    <InlineError
      title="Couldn’t save the guard configuration"
      description={error.message}
      onRetry={error.shouldReadAgain ? onReadAgain : undefined}
      isRetrying={isReading}
      className="min-w-0 break-words"
    />
  );
}
