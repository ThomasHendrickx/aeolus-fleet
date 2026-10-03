'use client';

import { CircleAlert, Copy, FileText, Info, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../atoms/button';
import { CodeBlock } from '../atoms/code-block';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Skeleton } from '../atoms/skeleton';
import { InlineError } from '../molecules/inline-error';

/** issuing: squadrons is issuing it; shown: the line, once; error: nothing was issued. */
export type CrewLineDialogState = 'issuing' | 'shown' | 'error';

interface CrewLineDialogProps {
  /** The member it crews, as named in the fleet. */
  memberName: string;
  state: CrewLineDialogState;
  /** Its template, as "tester@4", for the launch note's heading; none when unknown. */
  template?: string;
  /** The launch note and crew line, once issued: shown only now. */
  launchNote?: string | null;
  crewLine?: string;
  /** What the new line ended: a session, or an unclaimed line. */
  replacedText?: string;
  /** Why issuing failed (error). */
  error?: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Try again (error). */
  onConfirm?: () => void;
}

function IssuedLine({ memberName, template, launchNote, crewLine }: { memberName: string; template?: string; launchNote: string | null; crewLine: string }) {
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
      <CodeBlock label="Crew line" code={crewLine} isWrapped copyLabel={`Copy the crew line for ${memberName}`} codeTestId="crew-line-text" copyTestId="crew-line-copy" />
      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <Info aria-hidden className="size-(--size-icon-sm) shrink-0" />
        <span>
          <span className="font-medium">Shown once.</span> Paste it into Claude Code started where the launch note says. A new crew line stops this one working.
        </span>
      </p>
    </>
  );
}

/**
 * One member's launch note and crew line, shown once
 * (docs/design/png/CrewLineDialog.png): after Add member, and from Get new
 * crew line, issued at once; the dialog says what the new line ended, a
 * session or an unclaimed line. Follows the StartingPromptDialog: the line holds a secret, so it is
 * never shown again. Desktop: a dialog; phone: full screen.
 */
export function CrewLineDialog({ memberName, state, template, launchNote = null, crewLine, replacedText, error, isOpen, onOpenChange, onConfirm }: CrewLineDialogProps) {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const isIssuing = state === 'issuing';
  const copyAndClose = async () => {
    try {
      await navigator.clipboard.writeText(crewLine ?? '');
      onOpenChange(false);
    } catch {
      setHasCopyFailed(true);
    }
  };

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
          <DialogDescription>Start Claude Code where the launch note says, then paste the crew line. The member is on station once its session checks in.</DialogDescription>
        </DialogHeader>
        {state !== 'error' && replacedText !== undefined && (
          <p data-testid="crew-line-replaced" className="rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg">
            {replacedText}
          </p>
        )}
        {isIssuing && (
          <div aria-busy className="flex flex-col gap-3">
            <span className="sr-only">Issuing a crew line...</span>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        )}
        {state === 'shown' && crewLine !== undefined && <IssuedLine memberName={memberName} template={template} launchNote={launchNote} crewLine={crewLine} />}
        {state === 'error' && (
          <InlineError
            title="Couldn't issue a crew line"
            description={`${error ?? 'The squadron manager did not answer.'} No new secret was created; an earlier crew line still works.`}
          />
        )}
        {hasCopyFailed && (
          <p role="status" className="flex items-center gap-1.5 text-meta text-destructive-text">
            <CircleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Could not copy: select the text and copy it by hand.
          </p>
        )}
        <DialogFooter>
          {(state === 'shown' || isIssuing) && (
            <>
              <DialogClose render={<Button data-testid="crew-line-done" disabled={isIssuing} />}>Done</DialogClose>
              <Button
                variant="primary"
                icon={<Copy aria-hidden />}
                disabled={isIssuing}
                data-testid="crew-line-copy-and-close"
                onClick={() => {
                  void copyAndClose();
                }}
              >
                Copy and close
              </Button>
            </>
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
