'use client';

import type { ListedShip } from '@aeolus-fleet/common';
import { useState } from 'react';

import { locationText } from '../../lib/location';
import { isReleasable } from '../../lib/release';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { TableCell, TableRow } from '../atoms/table';
import { ShipName } from './ship-name';
import { StatusBadge } from './status-badge';

/** An inline confirm in the row: the question, its consequences, then the action and Cancel. */
const CONFIRM =
  'mt-2 ml-auto flex max-w-96 text-left flex-col gap-2 rounded-lg border border-border bg-card p-3 text-meta shadow-sm';
const CONFIRM_ACTIONS = 'flex flex-row-reverse justify-end gap-2';

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
    <TableRow data-testid="fleet-ship">
      <th scope="row" className="h-(--size-row) px-4 text-left align-middle font-normal">
        <ShipName name={ship.name} shipId={ship.id} />
      </th>
      <TableCell>
        <Badge variant="type">{ship.type}</Badge>
      </TableCell>
      <TableCell>
        <StatusBadge status={ship.status} />
      </TableCell>
      <TableCell data-testid="fleet-ship-location" className="text-meta text-muted-foreground">
        {locationText(ship)}
      </TableCell>
      <TableCell className="text-meta text-muted-foreground">
        <PromptState ship={ship} />
      </TableCell>
      <TableCell className="py-2.5 text-right">
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
      </TableCell>
    </TableRow>
  );
}
