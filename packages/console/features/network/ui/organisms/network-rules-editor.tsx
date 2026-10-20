'use client';

import { NETWORK_VERBS, type NetworkRule, type NetworkVerb } from '@aeolus-fleet/common';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { filterGroupsOf, type LabelContext } from '../../../../lib/labels';
import {
  addRule,
  addTerm,
  draftOf,
  hasSameValueOnOneSide,
  isChanged,
  ownerChoicesOf,
  removeRule,
  removeTerm,
  rulesOf,
  sameValueProblemOf,
  selectorOf,
  setRulesOn,
  setVerb,
  VERB_WORDS,
  type NetworkLimits,
  type RuleSide,
} from '../../../../lib/network-rules';
import { Button } from '../../../../components/atoms/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/atoms/select';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LabelSelectorField } from '../molecules/label-selector-field';

interface NetworkRulesEditorProps {
  /** The rules of the fleet's draft, or the applied rules without one: none is all-to-all. */
  rules: readonly NetworkRule[] | null;
  /** The fleet's labels, for the chips and the picker. */
  context: LabelContext;
  limits: NetworkLimits;
  isSaving: boolean;
  /** Why the last save failed, as the fleet says it: the editor keeps its changes. */
  saveError?: string;
  /** What the last save says. */
  savedNote?: string;
  /** Saves the whole list as the fleet's draft, or none for all-to-all. */
  onSave: (rules: NetworkRule[] | null) => void;
}

const SIDES: readonly { side: RuleSide; label: string }[] = [
  { side: 'from', label: 'From ships with' },
  { side: 'to', label: 'To ships with' },
];

const isVerb = (value: unknown): value is NetworkVerb => NETWORK_VERBS.some((verb) => verb === value);

const newKey = () => crypto.randomUUID();

const withProblem = (problem: string | undefined) => (problem === undefined ? {} : { problem });

/**
 * The fleet's own network rules, for a fleet:network session (#260; decision
 * 0034): all-to-all until rules are applied; then each rule lets the ships meeting every term on
 * its left send to, read or manage, by its verb, those meeting every term on
 * its right: an exact value, any value of a key, the same value as the other
 * side, or an owner. The built-in and declared rules hold beside them. The
 * changes are this editor's own until Save keeps them whole as the fleet's
 * draft, which nothing is checked against until it is applied; a failed save
 * keeps them, and a same value on one side only, which the fleet refuses,
 * keeps Save off.
 */
export function NetworkRulesEditor({ rules, context, limits, isSaving, saveError, savedNote, onSave }: NetworkRulesEditorProps) {
  const [draft, setDraft] = useState(() => draftOf(rules, newKey));
  const groups = filterGroupsOf(context);
  const ownerChoices = ownerChoicesOf(context);
  const hasChanges = isChanged(draft, rules);

  return (
    <section aria-labelledby="network-rules" data-testid="network-rules" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-rules" className="text-body font-semibold">
        Rules
      </h2>
      {draft.kind === 'all-to-all' ? (
        <>
          <p className="text-body" data-testid="network-rules-state">
            No rules: every ship may send to, read and manage every ship.
          </p>
          <p className="text-meta text-muted-foreground">
            With rules, a ship may send to, read or manage another only when a rule of that verb or a built-in rule allows it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={hasChanges ? 'secondary' : 'primary'}
              icon={<Plus aria-hidden />}
              disabled={isSaving}
              data-testid="network-rules-on"
              onClick={() => {
                setDraft(setRulesOn(draft, true));
              }}
            >
              Set rules
            </Button>
            {hasChanges ? (
              <>
                <Button
                  variant="primary"
                  isLoading={isSaving}
                  data-testid="network-rules-save"
                  onClick={() => {
                    onSave(null);
                  }}
                >
                  Save draft
                </Button>
                <Button
                  disabled={isSaving}
                  data-testid="network-rules-discard"
                  onClick={() => {
                    setDraft(draftOf(rules, newKey));
                  }}
                >
                  Discard changes
                </Button>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="text-body" data-testid="network-rules-state">
            {draft.rules.length === 0
              ? 'No rule allows anything yet: once saved, only the built-in rules hold.'
              : 'A ship may send to, read or manage another only when a rule of that verb or a built-in rule allows it.'}
          </p>
          {draft.rules.length === 0 ? null : (
            <ul className="flex flex-col gap-2">
              {draft.rules.map((rule, index) => (
                <li key={rule.key} data-testid="network-rule" className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:gap-3">
                  {SIDES.map(({ side, label }) => {
                    const selector = selectorOf(rule[side], context);
                    return (
                      <div key={side} className="flex min-w-0 grow basis-0 items-start gap-3">
                        {side === 'to' ? (
                          <div className="flex shrink-0 flex-col gap-1">
                            <span className="text-meta text-muted-foreground">Verb</span>
                            <Select
                              items={VERB_WORDS}
                              value={rule.verb}
                              disabled={isSaving}
                              onValueChange={(picked) => {
                                if (isVerb(picked)) {
                                  setDraft(setVerb(draft, { rule: rule.key, verb: picked }));
                                }
                              }}
                            >
                              <SelectTrigger aria-label={`Verb of rule ${String(index + 1)}`} data-testid="network-rule-verb" size="sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {NETWORK_VERBS.map((verb) => (
                                  <SelectItem key={verb} value={verb}>
                                    {VERB_WORDS[verb]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        {side === 'to' ? <ArrowRight aria-hidden className="mt-6 hidden size-(--size-icon) shrink-0 text-muted-foreground sm:block" /> : null}
                        <LabelSelectorField
                          label={label}
                          picked={selector.chips}
                          owners={selector.owners}
                          ownerChoices={ownerChoices}
                          unknown={selector.unknown}
                          groups={groups}
                          max={limits.selectorMax}
                          isDisabled={isSaving}
                          {...withProblem(sameValueProblemOf(rule, { side, context }))}
                          testId={`network-rule-${side}`}
                          popoverTestId="network-rule-popover"
                          onAdd={(term) => {
                            setDraft(addTerm(draft, { rule: rule.key, side, term, limits }));
                          }}
                          onRemove={(term) => {
                            setDraft(removeTerm(draft, { rule: rule.key, side, term }));
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
              disabled={!hasChanges || hasSameValueOnOneSide(draft)}
              data-testid="network-rules-save"
              onClick={() => {
                onSave(rulesOf(draft));
              }}
            >
              Save draft
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
                setDraft(setRulesOn(draft, false));
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
    </section>
  );
}
