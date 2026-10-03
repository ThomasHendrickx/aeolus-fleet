'use client';

import { CircleAlert, Info, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { shortDateTime } from '../../lib/relative-time';
import { Button } from '../atoms/button';
import { CodeBlock } from '../atoms/code-block';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Skeleton } from '../atoms/skeleton';
import { InlineError } from '../molecules/inline-error';

/** issuing: the server is issuing it; shown: the prompt, once; error: nothing was issued. */
export type StartingPromptDialogState = 'issuing' | 'shown' | 'error';

interface StartingPromptDialogProps {
  shipName: string;
  state: StartingPromptDialogState;
  /** The prompt and its crew line, once issued: shown only now. */
  prompt?: string;
  crewLine?: string;
  /** The unclaimed prompt that was out, which this one stops working. */
  replacesUnclaimed?: { issuedAt: string };
  /** Why issuing failed (error). */
  error?: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Try again (error). */
  onConfirm: () => void;
}

/** The prompt and the crew line, each with its copy button; says how to copy by hand when the clipboard refuses. */
function IssuedPrompt({ shipName, prompt, crewLine }: { shipName: string; prompt: string; crewLine: string }) {
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const copied = () => {
    setHasCopyFailed(false);
  };
  const failed = () => {
    setHasCopyFailed(true);
  };

  return (
    <>
      <p className="flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-meta text-foreground">
        <Info aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">Shown once. Copy it now.</span> If you lose it, get a new one; this one then
          stops working.
        </span>
      </p>
      <CodeBlock
        label={`Starting prompt for ${shipName}`}
        code={prompt}
        isWrapped
        copyLabel={`Copy the starting prompt for ${shipName}`}
        codeTestId="starting-prompt-text"
        copyTestId="starting-prompt-copy"
        onCopied={copied}
        onCopyFailed={failed}
      />
      <CodeBlock
        label="Crew line, Claude Code with the aeolus plugin"
        code={crewLine}
        isWrapped
        copyLabel={`Copy the crew line for ${shipName}`}
        codeTestId="starting-prompt-crew-line"
        copyTestId="starting-prompt-crew-line-copy"
        onCopied={copied}
        onCopyFailed={failed}
      />
      <p role="status" className="flex items-center gap-1.5 text-meta text-destructive-text empty:hidden">
        {hasCopyFailed ? (
          <>
            <CircleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Could not copy: select the text and copy it by hand.
          </>
        ) : null}
      </p>
    </>
  );
}

/**
 * Shows a freshly issued starting prompt and its crew line once
 * (docs/design/png/StartingPromptDialog.png). For a ship whose unclaimed
 * prompt is still out it first says that a new one stops that one working,
 * and issues only on Get new prompt. Closing without copying is allowed; the
 * ship then offers a new prompt. Desktop: a dialog; phone: full screen.
 */
export function StartingPromptDialog(props: StartingPromptDialogProps) {
  const { shipName, state, prompt, crewLine, replacesUnclaimed, error, isOpen, onOpenChange, onConfirm } = props;
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
      <DialogContent size="md" data-testid="starting-prompt-dialog" className={dialogSurface.phoneFullScreen}>
        <DialogHeader>
          <DialogTitle>Starting prompt for {shipName}</DialogTitle>
          <DialogDescription>
            Paste it into the agent session that should crew this ship, or the crew line into Claude Code with the
            aeolus plugin. Any earlier prompt for {shipName} stops working now.
          </DialogDescription>
        </DialogHeader>

        {state !== 'error' && replacesUnclaimed ? (
          <p className="rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg">
            This prompt stops the one issued{' '}
            <time dateTime={replacesUnclaimed.issuedAt}>{shortDateTime(new Date(replacesUnclaimed.issuedAt))}</time>{' '}
            working.
          </p>
        ) : null}
        {isIssuing ? (
          <div aria-busy className="flex flex-col gap-3">
            <span className="sr-only">Issuing a starting prompt...</span>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : null}
        {state === 'shown' && prompt !== undefined && crewLine !== undefined ? (
          <IssuedPrompt shipName={shipName} prompt={prompt} crewLine={crewLine} />
        ) : null}
        {state === 'error' ? (
          <InlineError
            title="Couldn’t issue a starting prompt"
            description={`${error ?? 'The server did not answer.'} No new secret was created; any earlier prompt still works.`}
          />
        ) : null}

        <DialogFooter>
          {state === 'issuing' || state === 'shown' ? (
            <DialogClose render={<Button variant="primary" disabled={isIssuing} />}>Done</DialogClose>
          ) : null}
          {state === 'error' ? (
            <>
              <DialogClose render={<Button />}>Close</DialogClose>
              <Button variant="primary" icon={<RotateCw />} onClick={onConfirm}>
                Try again
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
