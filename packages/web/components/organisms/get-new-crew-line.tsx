'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { useState, type ReactNode } from 'react';

import { newCrewLineReplaced } from '../../lib/ship-dialogs';
import { useNewCrewLine } from '../../lib/squadrons-api';
import { Button } from '../atoms/button';
import { CrewLineDialog, type CrewLineDialogState } from './crew-line-dialog';

interface NewCrewLineFor {
  squadronId: string;
  member: { shipId: string; name: string };
  /** Its ship as the fleet has it: whether a new line ends a session or an unclaimed line. Until known, it cannot start. */
  ship: ShipDetail | undefined;
  /** Its template, as "tester@4", for the launch note's heading. */
  template?: string;
}

/**
 * Get new crew line for a member as a flow: `start` issues it at once, with
 * no confirm (docs/design/conventions.md, "Confirm"); `dialog` shows the line
 * and launch note once, and what the new line ended. Kept apart from its trigger,
 * so a row menu can start it and close while the dialog stays.
 */
export function useNewCrewLineFlow(of: NewCrewLineFor | undefined): { isReady: boolean; start: () => void; dialog: ReactNode } {
  const newCrewLine = useNewCrewLine();
  const [isOpen, setIsOpen] = useState(false);
  const [replacedText, setReplacedText] = useState<string | undefined>(undefined);
  const issue = () => {
    if (of) {
      newCrewLine.mutate({ squadronId: of.squadronId, shipId: of.member.shipId });
    }
  };
  const state: CrewLineDialogState = newCrewLine.data ? 'shown' : newCrewLine.isError ? 'error' : 'issuing';
  return {
    isReady: of?.ship !== undefined,
    start: () => {
      if (!of?.ship) {
        return;
      }
      newCrewLine.reset();
      setReplacedText(newCrewLineReplaced(of.ship));
      setIsOpen(true);
      issue();
    },
    dialog: of ? (
      <CrewLineDialog
        memberName={of.member.name}
        state={state}
        template={of.template}
        launchNote={newCrewLine.data?.launchNote}
        crewLine={newCrewLine.data?.crewLine}
        replacedText={replacedText}
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
    ) : null,
  };
}

/** Get new crew line for a member as a button, primary for a silent member (docs/design/conventions.md, "Squadrons"). */
export function GetNewCrewLine({ isPrimary = false, testId, ...of }: NewCrewLineFor & { isPrimary?: boolean; testId: string }) {
  const flow = useNewCrewLineFlow(of);
  return (
    <>
      <Button size="xs" variant={isPrimary ? 'primary' : 'secondary'} disabled={!flow.isReady} data-testid={testId} onClick={flow.start}>
        Get new crew line
      </Button>
      {flow.dialog}
    </>
  );
}
