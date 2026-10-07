'use client';

import type { ShipDetail, TimelineEntry } from '@aeolus-fleet/common';
import { useState } from 'react';

import { useAccess } from '../../lib/access';
import { crewRequestStage, releaseSteps, requestedBy, statusChangedAt, type CrewRequestStage } from '../../lib/crew-request';
import { settingsRows } from '../../lib/crew-settings-form';
import { useGetStartingPrompt, useLabelContext, useReleaseShip, useRemoveCrewRequest, useRequestCrew } from '../../lib/fleet';
import { pickedChips } from '../../lib/labels';
import { machineLabelIdsOf } from '../../lib/machine-labels';
import { isUnclaimedPromptOut } from '../../lib/starting-prompt';
import { useHasTrierarchPlugin } from '../../lib/trierarch-plugin';
import { showToast } from '../atoms/toast';
import { CrewReleaseDialog } from './crew-release-dialog';
import { CrewRequestCard, type CrewRequestBusy } from './crew-request-card';
import { useRequestCrewFlow } from './request-crew-flow';
import { StartingPromptDialog } from './starting-prompt-dialog';

/** Where a ship's session runs, as the release confirm names it. */
function sessionLocationOf(ship: ShipDetail): string | null {
  return ship.location === null ? null : (ship.location.description ?? ship.location.kind.toLowerCase());
}

/**
 * A ship's crew request card, wired to the fleet (#245): Request crew writes a
 * request with no settings, or with the trierarch plugin on opens the form
 * for its settings, which Edit opens again with the settings held; Restart writes the held settings again as a new
 * version, Remove request deletes an unassigned request, and Release removes
 * the request, then ends a hand crew's lease. Nothing for argo, the viewer
 * ship or a retired ship, which never hold one.
 */
export function ShipCrewRequest({ ship, timeline, now }: { ship: ShipDetail; timeline: readonly TimelineEntry[]; now: Date }) {
  const access = useAccess();
  const hasTrierarchs = useHasTrierarchPlugin();
  const requestCrew = useRequestCrew();
  const labelContext = useLabelContext();
  const removeCrewRequest = useRemoveCrewRequest();
  const releaseShip = useReleaseShip();
  const getStartingPrompt = useGetStartingPrompt();
  const [busy, setBusy] = useState<CrewRequestBusy>();
  const [error, setError] = useState<{ action: Exclude<CrewRequestBusy, undefined>; message: string }>();
  const [isReleasing, setIsReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string>();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [replacedPrompt, setReplacedPrompt] = useState<{ issuedAt: string }>();
  const requestFlow = useRequestCrewFlow(ship.kind === 'agent' && ship.status !== 'retired' ? { shipId: ship.id, shipName: ship.name, heldSettings: ship.crewRequest?.settings } : undefined);

  if (ship.kind !== 'agent' || ship.status === 'retired') {
    return null;
  }
  const stage = crewRequestStage(ship);
  const request = ship.crewRequest;

  /** Runs one call of the card, showing it busy, and keeps its failure on the card. */
  const run = async (action: Exclude<CrewRequestBusy, undefined>, call: () => Promise<unknown>): Promise<boolean> => {
    setBusy(action);
    setError(undefined);
    try {
      await call();
      return true;
    } catch (caught) {
      setError({ action, message: caught instanceof Error ? caught.message : String(caught) });
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const requestPrompt = () => {
    getStartingPrompt.reset();
    // No confirm: the dialog says the prompt it replaces stops working.
    setReplacedPrompt(isUnclaimedPromptOut(ship) && ship.startingPrompt ? { issuedAt: ship.startingPrompt.issuedAt } : undefined);
    setIsPromptOpen(true);
    getStartingPrompt.mutate({ shipId: ship.id });
  };

  const onRequest = async () => {
    // Without the trierarch plugin a request holds no settings: it is the operator's to-do, crewed by hand.
    const isDone = await run('request', () => requestCrew.mutateAsync({ shipId: ship.id, settings: {} }));
    if (isDone) {
      showToast({
        title: `${ship.name} needs crew`,
        description: 'It is on your Needs crew list until you crew it.',
        tone: 'success',
        ...(ship.status === 'awaitingCrew' && access.canManage ? { action: { label: 'Get starting prompt', onClick: requestPrompt } } : {}),
      });
    }
  };

  const onRestart = async () => {
    if (request === null || stage.kind !== 'assigned') {
      return;
    }
    // Restart is the same request again: its new version tells the trierarch to crew the ship anew.
    const isDone = await run('restart', () => requestCrew.mutateAsync({ shipId: ship.id, settings: request.settings }));
    if (isDone) {
      showToast({ title: `Restarting ${ship.name}`, description: `${stage.trierarch.name} starts its session again with the same settings.`, tone: 'success' });
    }
  };

  const onConfirmRelease = async (released: Extract<CrewRequestStage, { kind: 'crewedByHand' | 'assigned' }>) => {
    setReleaseError(undefined);
    const steps = releaseSteps(released);
    let done = 0;
    try {
      for (const step of steps) {
        await (step === 'removeCrewRequest' ? removeCrewRequest.mutateAsync({ shipId: ship.id }) : releaseShip.mutateAsync({ shipId: ship.id }));
        done += 1;
      }
      setIsReleasing(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setReleaseError(done === 0 ? `${message} Nothing changed.` : `${message} Its crew request is removed; the session still holds the ship. Try again to end its lease.`);
    }
  };

  return (
    <>
      <CrewRequestCard
        stage={stage}
        requestedBy={requestedBy(timeline)}
        statusChangedAt={statusChangedAt(timeline)}
        now={now}
        canManage={access.canManage}
        isAwaitingCrew={ship.status === 'awaitingCrew'}
        hasTrierarchs={hasTrierarchs}
        busy={busy}
        error={error}
        settingsRows={request === null ? undefined : settingsRows(request.settings)}
        {...(request === null || labelContext === undefined ? {} : { machineLabels: pickedChips(machineLabelIdsOf(request.settings), labelContext) })}
        onRequest={() => {
          if (hasTrierarchs) {
            requestFlow.open('request');
          } else {
            void onRequest();
          }
        }}
        {...(hasTrierarchs ? { onEdit: () => { requestFlow.open('edit'); } } : {})}
        onRemove={() => void run('remove', () => removeCrewRequest.mutateAsync({ shipId: ship.id }))}
        onRelease={() => {
          setReleaseError(undefined);
          setIsReleasing(true);
        }}
        onRestart={() => void onRestart()}
        onGetStartingPrompt={requestPrompt}
      />
      {requestFlow.dialog}
      {stage.kind === 'crewedByHand' || stage.kind === 'assigned' ? (
        <CrewReleaseDialog
          shipName={ship.name}
          stage={stage}
          sessionLocation={sessionLocationOf(ship)}
          inFlightCount={ship.inFlightDeliveries}
          isOpen={isReleasing}
          onOpenChange={setIsReleasing}
          isPending={removeCrewRequest.isPending || releaseShip.isPending}
          error={releaseError}
          onConfirm={() => void onConfirmRelease(stage)}
        />
      ) : null}
      <StartingPromptDialog
        shipName={ship.name}
        state={getStartingPrompt.data ? 'shown' : getStartingPrompt.isError ? 'error' : 'issuing'}
        prompt={getStartingPrompt.data?.prompt}
        crewLines={getStartingPrompt.data?.crewLines}
        replacesUnclaimed={replacedPrompt}
        error={getStartingPrompt.error?.message}
        isOpen={isPromptOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            getStartingPrompt.reset();
            setIsPromptOpen(false);
          }
        }}
        onConfirm={() => {
          getStartingPrompt.mutate({ shipId: ship.id });
        }}
      />
    </>
  );
}
