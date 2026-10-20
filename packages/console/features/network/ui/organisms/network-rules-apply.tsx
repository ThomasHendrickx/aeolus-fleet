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
import { Button } from '../../../../components/atoms/button';
import { dialogSurface } from '../../../../components/atoms/dialog-surface';
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
}

/**
 * Applying the draft of the network rules (decision 0034): nothing is
 * checked against the draft until it is applied, so a change of rules is
 * looked at before it breaks anything. Apply confirms first, as it changes
 * who reaches whom from then on. Says when the settings moved since the draft
 * was saved. Props only.
 */
export function NetworkRulesApply({ draft, appliedVersion, isApplying, applyError, onApply }: NetworkRulesApplyProps) {
  const [isConfirming, setIsConfirming] = useState(false);

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
          <div>
            <Button
              variant="primary"
              isLoading={isApplying}
              data-testid="network-rules-apply-open"
              onClick={() => {
                setIsConfirming(true);
              }}
            >
              Apply draft
            </Button>
          </div>
        </>
      )}
      {applyError === undefined ? null : <InlineError variant="field" title="Couldn’t apply the draft" description={applyError} />}
      <AlertDialog
        open={isConfirming}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isApplying) {
            setIsConfirming(false);
          }
        }}
      >
        <AlertDialogContent data-testid="network-rules-apply-dialog" className={dialogSurface.phoneSheet}>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply the draft?</AlertDialogTitle>
            <AlertDialogDescription>Every send, read and manage is checked against the draft from now on, and the rules before it are gone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button disabled={isApplying} />}>Cancel</AlertDialogClose>
            <Button
              variant="primary"
              isLoading={isApplying}
              data-testid="network-rules-apply-confirm"
              onClick={() => {
                setIsConfirming(false);
                onApply();
              }}
            >
              Apply draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
