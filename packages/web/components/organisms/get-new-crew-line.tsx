'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { useState } from 'react';

import { newCrewLineConfirm } from '../../lib/ship-dialogs';
import { useNewCrewLine } from '../../lib/squadrons-api';
import { Button } from '../atoms/button';
import { CrewLineDialog, type CrewLineDialogState } from './crew-line-dialog';

interface GetNewCrewLineProps {
  squadronId: string;
  member: { shipId: string; name: string };
  /** Its ship as the fleet has it: whether a new line ends a session or an unclaimed line. Until known, the button waits. */
  ship: ShipDetail | undefined;
  /** Its template, as "tester@4", for the launch note's heading. */
  template?: string;
  /** Primary for a silent member (docs/design/conventions.md, "Squadrons"). */
  isPrimary?: boolean;
  testId: string;
}

/**
 * Get new crew line for a member, and the CrewLineDialog it opens: a normal
 * confirm first when the new line ends a session or an unclaimed line, at
 * once otherwise; then the line and launch note, once.
 */
export function GetNewCrewLine({ squadronId, member, ship, template, isPrimary = false, testId }: GetNewCrewLineProps) {
  const newCrewLine = useNewCrewLine();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState<string | undefined>(undefined);
  const issue = () => {
    newCrewLine.mutate({ squadronId, shipId: member.shipId });
  };
  const state: CrewLineDialogState = newCrewLine.data ? 'shown' : newCrewLine.isPending ? 'issuing' : newCrewLine.isError ? 'error' : 'confirm';

  return (
    <>
      <Button
        size="xs"
        variant={isPrimary ? 'primary' : 'secondary'}
        disabled={ship === undefined}
        data-testid={testId}
        onClick={() => {
          if (!ship) {
            return;
          }
          newCrewLine.reset();
          const asked = newCrewLineConfirm(ship);
          setConfirmText(asked);
          setIsOpen(true);
          if (asked === undefined) {
            issue();
          }
        }}
      >
        Get new crew line
      </Button>
      <CrewLineDialog
        memberName={member.name}
        state={state}
        template={template}
        launchNote={newCrewLine.data?.launchNote}
        crewLine={newCrewLine.data?.crewLine}
        confirmText={confirmText}
        error={newCrewLine.error?.message}
        isOpen={isOpen}
        onOpenChange={(isNowOpen) => {
          setIsOpen(isNowOpen);
          if (!isNowOpen) {
            newCrewLine.reset();
          }
        }}
        onConfirm={issue}
      />
    </>
  );
}
