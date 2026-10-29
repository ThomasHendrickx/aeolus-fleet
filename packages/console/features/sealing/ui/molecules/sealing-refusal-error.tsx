import type { FleetId } from '@aeolus-fleet/common';

import { InlineError } from '../../../../components/molecules/inline-error';
import type { SealingRefusal } from '../../services/sealing-refusal';
import { keyCondition } from './key-condition';

/** Why a key change was refused, inline in its dialog, saying nothing changed and what to do (sealing page mockup). */
export function SealingRefusalError({ refusal, fleetId, failed }: { refusal: SealingRefusal; fleetId: FleetId; failed: string }) {
  switch (refusal.kind) {
    case 'keyNotBoundToFleet':
      return (
        <InlineError
          title="The key’s policy doesn’t name this fleet"
          description={
            <>
              Add the condition <span className="font-mono">{keyCondition(fleetId)}</span> to it and try again. Nothing changed.
            </>
          }
        />
      );
    case 'keyUnavailable':
      return (
        <InlineError
          title={`Couldn’t use the key: ${refusal.reason}`}
          description={
            refusal.reason === 'access denied'
              ? 'Your KMS refused this installation. Grant it use of the key and try again. Nothing changed.'
              : `Your KMS answers: ${refusal.reason}. Try again once the key is reachable. Nothing changed.`
          }
        />
      );
    case 'currentKeyUnavailable':
      return (
        <InlineError title="Your current company key is not reachable" description="Changing it needs the current key too. Nothing changed. With a recovery key, recover with core’s command line." />
      );
    case 'other':
      return <InlineError title={failed} description={`Refused: ${refusal.message}. Nothing changed.`} />;
  }
}
