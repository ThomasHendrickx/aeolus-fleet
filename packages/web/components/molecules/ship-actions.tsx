'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { useState } from 'react';

import { isReleasable } from '../../lib/release';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { Button } from '../atoms/button';

/** An inline confirm in the row: the question, its consequences, then the action and Cancel. */
const CONFIRM =
  'mt-2 ml-auto flex max-w-96 text-left flex-col gap-2 rounded-lg border border-border bg-card p-3 text-meta shadow-sm';
const CONFIRM_ACTIONS = 'flex flex-row-reverse justify-end gap-2';

function IssuedAt({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
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
      <Button
        size="xs"
        data-testid="fleet-ship-release"
        isLoading={isReleasing}
        onClick={() => {
          setIsConfirming(true);
        }}
      >
        {isReleasing ? 'Releasing...' : 'Release'}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Release ${ship.name}?`} className={CONFIRM}>
      <p className="text-body font-semibold">Release {ship.name}?</p>
      <p className="text-muted-foreground">
        The session crewing it loses it now. Its secret stops working, so that session cannot come back. Deliveries in
        flight return to pending; nothing is lost. {ship.name} shows as Awaiting crew until you get a new starting
        prompt.
      </p>
      <div className={CONFIRM_ACTIONS}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setIsConfirming(false);
            onRelease();
          }}
        >
          Release ship
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setIsConfirming(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A ship's actions in the fleet overview. A ship awaiting crew offers a new
 * starting prompt; while an unclaimed one is still out, it asks first, because
 * the new prompt stops the old one working. A crewed ship other than argo
 * offers Release, after a confirm. The confirms stay inline until the
 * dialogs arrive.
 */
export function ShipActions({
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
    <div className="flex flex-col items-end gap-2 max-sm:items-start">
      {ship.status === 'awaitingCrew' && !promptToReplace ? (
        <Button size="xs" disabled={isIssuing} onClick={requestPrompt}>
          Get starting prompt
        </Button>
      ) : null}
      {isReleasable(ship) ? <ReleaseAction ship={ship} isReleasing={isReleasing} onRelease={onRelease} /> : null}
      {promptToReplace ? (
        <div role="group" aria-label={`Replace the starting prompt for ${ship.name}`} className={CONFIRM}>
          <p className="text-muted-foreground">
            An unclaimed prompt issued <IssuedAt iso={promptToReplace.issuedAt} /> is still out. A new one stops it
            working.
          </p>
          <div className={CONFIRM_ACTIONS}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setIsConfirming(false);
                onGetStartingPrompt();
              }}
            >
              Replace prompt
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIsConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
