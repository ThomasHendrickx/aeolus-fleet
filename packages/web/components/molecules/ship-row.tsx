'use client';

import type { ListedShip, ShipStatus } from '@aeolus-fleet/common';
import { useState } from 'react';

import { isUnclaimedPromptOut } from '../../lib/starting-prompt';

const STATUS_LABELS: Record<ShipStatus, string> = {
  awaitingCrew: 'Awaiting crew',
  crewed: 'Crewed',
  retired: 'Retired',
};

function IssuedAt({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}

function PromptState({ ship }: { ship: ListedShip }) {
  if (ship.startingPrompt === null) {
    return <>None</>;
  }
  return (
    <>
      {ship.startingPrompt.isClaimed ? 'Claimed' : 'Unclaimed'}, issued <IssuedAt iso={ship.startingPrompt.issuedAt} />
    </>
  );
}

/**
 * One ship in the fleet list. A ship awaiting crew offers a new starting
 * prompt; while an unclaimed one is still out, it asks first, because the new
 * prompt stops the old one working.
 */
export function ShipRow({
  ship,
  isIssuing,
  onGetStartingPrompt,
}: {
  ship: ListedShip;
  isIssuing: boolean;
  onGetStartingPrompt: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  function requestPrompt() {
    if (isUnclaimedPromptOut(ship)) {
      setIsConfirming(true);
    } else {
      onGetStartingPrompt();
    }
  }

  return (
    <tr data-testid="fleet-ship">
      <th scope="row">{ship.name}</th>
      <td>{ship.type}</td>
      <td>{STATUS_LABELS[ship.status]}</td>
      <td>
        <PromptState ship={ship} />
      </td>
      <td>
        {ship.status === 'awaitingCrew' && !isConfirming ? (
          <button type="button" disabled={isIssuing} onClick={requestPrompt}>
            Get starting prompt
          </button>
        ) : null}
        {isConfirming && ship.startingPrompt ? (
          <div role="group" aria-label={`Replace the starting prompt for ${ship.name}`}>
            <p>
              An unclaimed prompt issued <IssuedAt iso={ship.startingPrompt.issuedAt} /> is still out. A new one stops
              it working.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsConfirming(false);
                onGetStartingPrompt();
              }}
            >
              Replace prompt
            </button>
            <button
              type="button"
              onClick={() => {
                setIsConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
