import type { FleetId } from '@aeolus-fleet/common';

import { CopyButton } from '../../../../components/atoms/copy-button';
import { shortened } from '../../services/sealing-view';

/** The condition a company key's policy names this fleet by (decision 0068, B3; ES4). */
export function keyCondition(fleetId: FleetId): string {
  return `aeolus:fleet = ${fleetId}`;
}

/**
 * What a company key must be, under its field: an AWS KMS key whose policy
 * lets this installation use it with the condition naming this fleet, the
 * condition shown to copy whole.
 */
export function KeyCondition({ fleetId, id }: { fleetId: FleetId; id?: string }) {
  return (
    <p id={id} className="text-meta text-muted-foreground">
      An AWS KMS key whose policy lets this installation use it with the condition{' '}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span className="font-mono text-id text-foreground" title={keyCondition(fleetId)}>
          aeolus:fleet = {shortened(fleetId)}
        </span>
        <CopyButton value={keyCondition(fleetId)} label="Copy condition" size="xs" data-testid="sealing-copy-condition" />
      </span>
    </p>
  );
}
