import type { SelectorTerm } from '@aeolus-fleet/common';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { Fragment } from 'react';

import type { LabelContext } from '../../../../lib/labels';
import { selectorOf, TERM_MEANINGS, termKeyOf, VERB_WORDS, type RuleSide } from '../../../../lib/network-rules';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LabelChip } from '../../../../components/molecules/label-chip';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import type { DeclaredRules } from '../../services/declared-rules';

export interface DeclaredNetworkRulesProps {
  /** Each declarer's rules, by its name; undefined while not known. */
  declared: readonly DeclaredRules[] | undefined;
  /** Why the fleet could not list them. */
  error?: string;
  onRetry?: () => void;
  /** The fleet's labels, for the chips. */
  context: LabelContext;
}

const SIDES: readonly { side: RuleSide; label: string }[] = [
  { side: 'from', label: 'From ships with' },
  { side: 'to', label: 'To ships with' },
];

/**
 * The rules plugins and the installation declared on Network (design point
 * 6 on #573; decisions 0037, 0052): apart from argo's own, each list under
 * its declarer. Argo reads them and edits nothing: only the declarer changes
 * them, and switching a plugin off withdraws its rules.
 */
export function DeclaredNetworkRules({ declared, error, onRetry, context }: DeclaredNetworkRulesProps) {
  let content;
  if (error !== undefined) {
    content = <InlineError title="Couldn’t read the declared rules" description={error} onRetry={onRetry} />;
  } else if (declared === undefined) {
    content = <LoadingSkeleton variant="list" rows={2} label="Loading the declared rules" />;
  } else if (declared.length === 0) {
    content = <EmptyState variant="section" title="Nothing declares rules." />;
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {declared.map((each) => (
          <li key={each.declarerId} data-testid="network-declared-plugin" className="flex flex-col gap-2">
            <h3 className="text-meta font-medium" data-testid="network-declared-by">
              Declared by {each.declaredBy}
            </h3>
            <ul className="flex flex-col gap-2">
              {each.rules.map((rule) => (
                <li
                  key={JSON.stringify(rule)}
                  data-testid="network-declared-rule"
                  className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:gap-3"
                >
                  {SIDES.map(({ side, label }) => (
                    <div key={side} className="flex min-w-0 grow basis-0 items-start gap-3">
                      {side === 'to' ? (
                        <span className="mt-6 shrink-0 text-meta text-muted-foreground" data-testid="network-declared-rule-verb">
                          {VERB_WORDS[rule.verb]}
                        </span>
                      ) : null}
                      {side === 'to' ? <ArrowRight aria-hidden className="mt-6 hidden size-(--size-icon) shrink-0 text-muted-foreground sm:block" /> : null}
                      <Selector label={label} terms={rule[side]} context={context} testId={`network-declared-rule-${side}`} />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="network-declared" data-testid="network-declared" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-declared" className="text-body font-semibold">
        Declared by plugins and the installation
      </h2>
      <p className="text-meta text-muted-foreground">
        Rules plugins and the installation need on the labels they own. The networking plugin adds them to your rules; while every ship may message every ship, they
        change nothing. Only their declarer changes them, and switching a plugin off withdraws its rules.
      </p>
      {content}
    </section>
  );
}

/** One side of a declared rule, read-only: a chip per term, and a term whose label the fleet no longer has. */
function Selector({ label, terms, context, testId }: { label: string; terms: readonly SelectorTerm[]; context: LabelContext; testId: string }) {
  const { chips, unknown } = selectorOf(terms, context);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-meta text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.length + unknown.length === 0 ? <span className="text-body">Every ship</span> : null}
        {chips.map((chip, index) => (
          <Fragment key={termKeyOf(chip.term)}>
            {index === 0 ? null : <span className="text-meta text-muted-foreground">and</span>}
            <LabelChip chip={chip} testId={`${testId}-value`} {...(typeof chip.term === 'string' ? {} : { meaning: TERM_MEANINGS[chip.term.value] })} />
          </Fragment>
        ))}
        {unknown.map((term) => (
          <span
            key={termKeyOf(term)}
            data-testid={`${testId}-unknown`}
            title={`${termKeyOf(term)}: no longer in this fleet`}
            className="inline-flex h-5.5 items-center gap-1 rounded-sm border border-tone-attention-border bg-tone-attention-bg px-1.5 text-id text-tone-attention-fg [&_svg]:size-3"
          >
            <CircleAlert aria-hidden />
            A removed label
          </span>
        ))}
      </div>
    </div>
  );
}
