import { Lock, LockOpen } from 'lucide-react';

import { Button } from '@aeolus-fleet/ui';
import { EmptyState } from '../../../../components/molecules/empty-state';

const WHAT_SEALING_DOES = 'Payloads are stored readable. Sealing keeps them under your company’s own key in AWS KMS, so a copy of the database or the host reads none once you cut the key off.';

/**
 * A fleet that is not sealed (sealing page mockup, "Sealing off"): what
 * sealing does, and Turn on sealing with fleet:keys; without it, what turning
 * it on takes.
 */
export function SealingOff({ onTurnOn }: { onTurnOn?: () => void }) {
  return (
    <EmptyState
      icon={<LockOpen aria-hidden />}
      title="Sealing is off"
      description={
        onTurnOn === undefined ? (
          <>
            {WHAT_SEALING_DOES}{' '}
            <span className="block pt-1">
              Turning it on takes the scope <span className="font-mono">fleet:keys</span>.
            </span>
          </>
        ) : (
          WHAT_SEALING_DOES
        )
      }
      action={
        onTurnOn === undefined ? undefined : (
          <Button variant="primary" icon={<Lock />} className="max-sm:w-full" data-testid="sealing-turn-on" onClick={onTurnOn}>
            Turn on sealing
          </Button>
        )
      }
    />
  );
}
