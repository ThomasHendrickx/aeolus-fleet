'use client';

import type { CrewLine } from '@aeolus-fleet/common';
import { FileText, Info, RotateCw } from 'lucide-react';

import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Skeleton } from '../atoms/skeleton';
import { CrewLines } from '../molecules/crew-lines';
import { InlineError } from '../molecules/inline-error';

/** issuing: squadrons is issuing it; shown: the line, once; error: nothing was issued. */
export type CrewLineDialogState = 'issuing' | 'shown' | 'error';

interface CrewLineDialogProps {
  /** The member it crews, as named in the fleet. */
  memberName: string;
  state: CrewLineDialogState;
  /** Its template, as "tester@4", for the launch note's heading; none when unknown. */
  template?: string;
  /** The launch note and crew lines, one per harness, once issued: shown only now. */
  launchNote?: string | null;
  crewLines?: readonly CrewLine[];
  /** Why issuing failed (error). */
  error?: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Try again (error). */
  onConfirm?: () => void;
}

function IssuedLines({ memberName, template, launchNote, crewLines }: { memberName: string; template?: string; launchNote: string | null; crewLines: readonly CrewLine[] }) {
  return (
    <>
      {launchNote !== null && (
        <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-meta">
          <FileText aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
          <span className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Launch note{template === undefined ? '' : ` · ${template}`}</span>
            <span data-testid="crew-line-launch-note">{launchNote}</span>
          </span>
        </div>
      )}
      <CrewLines crewLines={crewLines} subject={memberName} testIdPrefix="crew-line-text" />
      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <Info aria-hidden className="size-(--size-icon-sm) shrink-0" />
        <span>
          <span className="font-medium">Shown once.</span> Paste a crew line into Claude Code or Codex started where the launch note says. A new crew line stops these working.
        </span>
      </p>
    </>
  );
}

/**
 * One member's launch note and crew lines, one per harness, shown once
 * (docs/design/png/CrewLineDialog.png): after Add member, and after Get new
 * crew line's confirm. Follows the StartingPromptDialog: the lines hold a
 * secret, so they are never shown again. Desktop: a dialog; phone: full screen.
 */
export function CrewLineDialog({ memberName, state, template, launchNote = null, crewLines, error, isOpen, onOpenChange, onConfirm }: CrewLineDialogProps) {
  const isIssuing = state === 'issuing';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isIssuing) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="crew-line-dialog" className={dialogSurface.phoneFullScreen}>
        <DialogHeader>
          <DialogTitle>Crew line for {memberName}</DialogTitle>
          <DialogDescription>Start Claude Code or Codex where the launch note says, then paste its crew line. The member is on station once its session checks in.</DialogDescription>
        </DialogHeader>
        {isIssuing && (
          <div aria-busy className="flex flex-col gap-3">
            <span className="sr-only">Issuing a crew line...</span>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        )}
        {state === 'shown' && crewLines !== undefined && <IssuedLines memberName={memberName} template={template} launchNote={launchNote} crewLines={crewLines} />}
        {state === 'error' && (
          <InlineError
            title="Couldn't issue a crew line"
            description={`${error ?? 'The squadron manager did not answer.'} No new secret was created; an earlier crew line still works.`}
          />
        )}
        <DialogFooter>
          {(state === 'shown' || isIssuing) && (
            <DialogClose render={<Button variant="primary" data-testid="crew-line-done" disabled={isIssuing} />}>Done</DialogClose>
          )}
          {state === 'error' && (
            <>
              <DialogClose render={<Button />}>Close</DialogClose>
              <Button variant="primary" icon={<RotateCw aria-hidden />} data-testid="crew-line-retry" onClick={onConfirm}>
                Try again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
