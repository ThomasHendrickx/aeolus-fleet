'use client';

import type { NetworkRule } from '@aeolus-fleet/common';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { filterGroupsOf, type LabelContext } from '../../lib/labels';
import { addRule, addValue, draftOf, isChanged, removeRule, removeValue, rulesOf, selectorOf, setRulesOn, type NetworkLimits, type RuleSide } from '../../lib/network-rules';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../atoms/alert-dialog';
import { Button } from '../atoms/button';
import { dialogSurface } from '../atoms/dialog-surface';
import { InlineError } from '../molecules/inline-error';
import { LabelSelectorField } from '../molecules/label-selector-field';

interface NetworkRulesEditorProps {
  /** The rules the networking plugin holds: none is all-to-all. */
  rules: readonly NetworkRule[] | null;
  /** The fleet's labels, for the chips and the picker. */
  context: LabelContext;
  limits: NetworkLimits;
  isSaving: boolean;
  /** Why the last save failed, as the networking plugin says it: the draft stays. */
  saveError?: string;
  /** What the last save did at the fleet. */
  savedNote?: string;
  /** Saves the whole list, or none for all-to-all. */
  onSave: (rules: NetworkRule[] | null) => void;
}

const SIDES: readonly { side: RuleSide; label: string }[] = [
  { side: 'from', label: 'From ships with' },
  { side: 'to', label: 'To ships with' },
];

const newKey = () => crypto.randomUUID();

/**
 * The network rules, argo's alone (#260; decisions 0034, 0036): all-to-all
 * until argo sets rules; then each rule lets the ships carrying every label
 * value on its left message those carrying every value on its right. Argo and
 * answers to a received message always get through. The draft is this
 * editor's own until Save sends it whole; a failed save keeps it. Turning
 * rules off drops every rule, so it confirms first.
 */
export function NetworkRulesEditor({ rules, context, limits, isSaving, saveError, savedNote, onSave }: NetworkRulesEditorProps) {
  const [draft, setDraft] = useState(() => draftOf(rules, newKey));
  const [isConfirmingOff, setIsConfirmingOff] = useState(false);
  const groups = filterGroupsOf(context);
  const hasChanges = isChanged(draft, rules);

  return (
    <section aria-labelledby="network-rules" data-testid="network-rules" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-rules" className="text-body font-semibold">
        Rules
      </h2>
      {draft.kind === 'all-to-all' ? (
        <>
          <p className="text-body" data-testid="network-rules-state">
            No rules: every ship may message every ship.
          </p>
          <p className="text-meta text-muted-foreground">
            With rules, a ship may message another only when a rule allows it. Argo always reaches every ship and every ship reaches argo, and a ship may always answer
            the sender of a message it received.
          </p>
          <div>
            <Button
              variant="primary"
              icon={<Plus aria-hidden />}
              disabled={isSaving}
              data-testid="network-rules-on"
              onClick={() => {
                setDraft(setRulesOn(draft, true));
              }}
            >
              Set rules
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body" data-testid="network-rules-state">
            {draft.rules.length === 0
              ? 'No rule allows anything yet: once saved, only argo and answers to a received message get through.'
              : 'A ship may message another only when a rule allows it. Argo and answers to a received message always get through.'}
          </p>
          {draft.rules.length === 0 ? null : (
            <ul className="flex flex-col gap-2">
              {draft.rules.map((rule, index) => (
                <li key={rule.key} data-testid="network-rule" className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:gap-3">
                  {SIDES.map(({ side, label }) => {
                    const selector = selectorOf(rule[side], context);
                    return (
                      <div key={side} className="flex min-w-0 grow basis-0 items-start gap-3">
                        {side === 'to' ? <ArrowRight aria-hidden className="mt-6 hidden size-(--size-icon) shrink-0 text-muted-foreground sm:block" /> : null}
                        <LabelSelectorField
                          label={label}
                          picked={selector.chips}
                          unknown={selector.unknown}
                          groups={groups}
                          max={limits.selectorMax}
                          isDisabled={isSaving}
                          testId={`network-rule-${side}`}
                          popoverTestId="network-rule-popover"
                          onAdd={(valueId) => {
                            setDraft(addValue(draft, { rule: rule.key, side, valueId, limits }));
                          }}
                          onRemove={(valueId) => {
                            setDraft(removeValue(draft, { rule: rule.key, side, valueId }));
                          }}
                        />
                      </div>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<Trash2 aria-hidden />}
                    disabled={isSaving}
                    aria-label={`Remove rule ${String(index + 1)}`}
                    data-testid="network-rule-remove"
                    onClick={() => {
                      setDraft(removeRule(draft, rule.key));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {draft.rules.length >= limits.rulesMax ? null : (
              <Button
                size="sm"
                icon={<Plus aria-hidden />}
                disabled={isSaving}
                data-testid="network-rules-add"
                onClick={() => {
                  setDraft(addRule(draft, { newKey, limits }));
                }}
              >
                Add rule
              </Button>
            )}
            <span className="text-meta text-muted-foreground tabular-nums" data-testid="network-rules-count">
              {draft.rules.length} of {limits.rulesMax} rules
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              variant="primary"
              isLoading={isSaving}
              disabled={!hasChanges}
              data-testid="network-rules-save"
              onClick={() => {
                onSave(rulesOf(draft));
              }}
            >
              Save rules
            </Button>
            {hasChanges ? (
              <Button
                disabled={isSaving}
                data-testid="network-rules-discard"
                onClick={() => {
                  setDraft(draftOf(rules, newKey));
                }}
              >
                Discard changes
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="ml-auto"
              disabled={isSaving}
              data-testid="network-rules-off"
              onClick={() => {
                if (rules === null) {
                  setDraft(setRulesOn(draft, false));
                } else {
                  setIsConfirmingOff(true);
                }
              }}
            >
              Remove all rules
            </Button>
          </div>
        </>
      )}
      {saveError === undefined ? null : <InlineError variant="field" title="Couldn’t save the rules" description={saveError} />}
      {savedNote === undefined || hasChanges ? null : (
        <p role="status" className="text-meta text-muted-foreground" data-testid="network-rules-note">
          {savedNote}
        </p>
      )}
      <AlertDialog
        open={isConfirmingOff}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSaving) {
            setIsConfirmingOff(false);
          }
        }}
      >
        <AlertDialogContent data-testid="network-rules-off-dialog" className={dialogSurface.phoneSheet}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all rules?</AlertDialogTitle>
            <AlertDialogDescription>
              Every ship may message every ship again from now on. The rules are gone: to have them back, set them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button disabled={isSaving} />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              isLoading={isSaving}
              data-testid="network-rules-off-confirm"
              onClick={() => {
                setIsConfirmingOff(false);
                onSave(null);
              }}
            >
              Remove all rules
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
