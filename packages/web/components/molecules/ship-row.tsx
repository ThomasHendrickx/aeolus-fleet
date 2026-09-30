'use client';

import type { ListedShip, ShipStatus } from '@aeolus-fleet/common';
import { useState } from 'react';

import { locationText } from '../../lib/location';
import { isReleasable } from '../../lib/release';
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
 * Release for a crewed ship, after a normal confirm (docs/design/conventions.md,
 * "Confirm"): a new starting prompt crews the ship again, so no typed confirm.
 * The confirm says what happens to the session, its secret and what it holds
 * in flight.
 */
function ReleaseAction({
  ship,
  isReleasing,
  onRelease,
}: {
  ship: ListedShip;
  isReleasing: boolean;
  onRelease: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <button
        type="button"
        data-testid="fleet-ship-release"
        disabled={isReleasing}
        onClick={() => {
          setIsConfirming(true);
        }}
      >
        {isReleasing ? 'Releasing...' : 'Release'}
      </button>
    );
  }
  return (
    <div role="group" aria-label={`Release ${ship.name}?`}>
      <p>Release {ship.name}?</p>
      <p>
        The session crewing it loses it now. Its secret stops working, so that session cannot come back. Deliveries in
        flight return to pending; nothing is lost. {ship.name} shows as Awaiting crew until you get a new starting
        prompt.
      </p>
      <button
        type="button"
        onClick={() => {
          setIsConfirming(false);
          onRelease();
        }}
      >
        Release ship
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
  );
}

/**
 * One ship in the fleet list. A ship awaiting crew offers a new starting
 * prompt; while an unclaimed one is still out, it asks first, because the new
 * prompt stops the old one working. A crewed ship other than argo offers
 * Release, after a confirm.
 */
export function ShipRow({
  ship,
  isIssuing,
  onGetStartingPrompt,
  isReleasing,
  onRelease,
}: {
  ship: ListedShip;
  isIssuing: boolean;
  onGetStartingPrompt: () => void;
  isReleasing: boolean;
  onRelease: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  // Asked only while the unclaimed prompt is still out: once a session claims
  // it, or the snapshot shows none, the row offers the button again.
  const promptToReplace = isConfirming && isUnclaimedPromptOut(ship) ? ship.startingPrompt : null;

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
      <td data-testid="fleet-ship-location">{locationText(ship)}</td>
      <td>
        <PromptState ship={ship} />
      </td>
      <td>
        {ship.status === 'awaitingCrew' && !promptToReplace ? (
          <button type="button" disabled={isIssuing} onClick={requestPrompt}>
            Get starting prompt
          </button>
        ) : null}
        {isReleasable(ship) ? <ReleaseAction ship={ship} isReleasing={isReleasing} onRelease={onRelease} /> : null}
        {promptToReplace ? (
          <div role="group" aria-label={`Replace the starting prompt for ${ship.name}`}>
            <p>
              An unclaimed prompt issued <IssuedAt iso={promptToReplace.issuedAt} /> is still out. A new one stops it
              working.
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
