'use client';

import { FileText, Info } from 'lucide-react';

import { CodeBlock } from '../atoms/code-block';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { Button } from '../atoms/button';
import { dialogSurface } from '../atoms/dialog-surface';

interface CrewLineDialogProps {
  /** The member it crews, as named in the fleet. */
  memberName: string;
  /** Its template, as "tester@4", for the launch note's heading; none when unknown. */
  template?: string;
  launchNote: string | null;
  crewLine: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * One member's launch note and crew line, shown once
 * (docs/design/png/CrewLineDialog.png): after Add member, and later after Get
 * new crew line. Follows the StartingPromptDialog: the line holds a secret, so
 * it is never shown again. Desktop: a dialog; phone: full screen.
 */
export function CrewLineDialog({ memberName, template, launchNote, crewLine, isOpen, onOpenChange }: CrewLineDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="crew-line-dialog" className={dialogSurface.phoneFullScreen}>
        <DialogHeader>
          <DialogTitle>Crew line for {memberName}</DialogTitle>
          <DialogDescription>Start Claude Code where the launch note says, then paste the crew line. The member is on station once its session checks in.</DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <DialogClose render={<Button variant="primary" data-testid="crew-line-done" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
