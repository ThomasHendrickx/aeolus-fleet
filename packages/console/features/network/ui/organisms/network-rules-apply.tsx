'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../../components/atoms/alert-dialog';
import { Button, dialogSurface } from '@aeolus-fleet/common/header';
import { InlineError } from '../../../../components/molecules/inline-error';

export interface NetworkRulesApplyProps {
  /** The fleet's draft, by the settings version it was saved against; null without one. */
  draft: { savedAgainstVersion: number } | null;
  /** The settings version the page shows, which the apply names. */
  appliedVersion: number;
  isApplying: boolean;
  /** Why the last apply failed, as the fleet says it: the draft stays. */
  applyError?: string;
  onApply: () => void;
  isDiscarding: boolean;
  /** Why the last discard failed, as the fleet says it. */
  discardError?: string;
  onDiscard: () => void;
}

/** What waits for a confirm: the apply, or the discard. */
type Confirming = 'apply' | 'discard' | null;

const CONFIRMS: Readonly<Record<Exclude<Confirming, null>, { title: string; description: string; action: string }>> = {
  apply: { title: 'Apply the draft?', description: 'Every send, read and manage is checked against the draft from now on, and the rules before it are gone.', action: 'Apply draft' },
  discard: { title: 'Discard the draft?', description: 'The draft is gone; the applied rules stay as they are.', action: 'Discard draft' },
};

/**
 * Applying the draft of the network rules (decision 0034): nothing is
 * checked against the draft until it is applied, so a change of rules is
 * looked at before it breaks anything. Apply confirms first, as it changes
 * who reaches whom from then on, and so does Discard, which drops the draft.
 * Says when the settings moved since the draft was saved. Props only.
 */
export function NetworkRulesApply({ draft, appliedVersion, isApplying, applyError, onApply, isDiscarding, discardError, onDiscard }: NetworkRulesApplyProps) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const isBusy = isApplying || isDiscarding;

  return (
    <section aria-labelledby="network-rules-apply" data-testid="network-rules-apply" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-rules-apply" className="text-body font-semibold">
        Apply
      </h2>
      {draft === null ? (
        <p className="text-meta text-muted-foreground" data-testid="network-rules-apply-state">
          No draft: the applied rules are the ones above. Save a draft to apply it.
        </p>
      ) : (
        <>
          <p className="text-body" data-testid="network-rules-apply-state">
            A draft is saved. Every send, read and manage is checked against the applied rules, at version {appliedVersion}, until it is applied.
          </p>
          {draft.savedAgainstVersion === appliedVersion ? null : (
            <p className="text-meta text-muted-foreground" data-testid="network-rules-apply-moved">
              The settings moved from version {draft.savedAgainstVersion} since the draft was saved.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              isLoading={isApplying}
              disabled={isDiscarding}
              data-testid="network-rules-apply-open"
              onClick={() => {
                setConfirming('apply');
              }}
            >
              Apply draft
            </Button>
            <Button
              variant="ghost"
              isLoading={isDiscarding}
              disabled={isApplying}
              data-testid="network-rules-discard-open"
              onClick={() => {
                setConfirming('discard');
              }}
            >
              Discard draft
            </Button>
          </div>
        </>
      )}
      {applyError === undefined ? null : <InlineError variant="field" title="Couldn’t apply the draft" description={applyError} />}
      {discardError === undefined ? null : <InlineError variant="field" title="Couldn’t discard the draft" description={discardError} />}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isBusy) {
            setConfirming(null);
          }
        }}
      >
        {confirming === null ? null : (
          <AlertDialogContent data-testid={`network-rules-${confirming}-dialog`} className={dialogSurface.phoneSheet}>
            <AlertDialogHeader>
              <AlertDialogTitle>{CONFIRMS[confirming].title}</AlertDialogTitle>
              <AlertDialogDescription>{CONFIRMS[confirming].description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button disabled={isBusy} />}>Cancel</AlertDialogClose>
              <Button
                variant={confirming === 'apply' ? 'primary' : 'destructive'}
                isLoading={isBusy}
                data-testid={`network-rules-${confirming}-confirm`}
                onClick={() => {
                  setConfirming(null);
                  if (confirming === 'apply') {
                    onApply();
                  } else {
                    onDiscard();
                  }
                }}
              >
                {CONFIRMS[confirming].action}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </section>
  );
}
