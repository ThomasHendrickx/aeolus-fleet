import { ArrowRight } from 'lucide-react';

import { VERB_WORDS } from '../../../../lib/network-rules';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { isUnchanged, type ReachChangeRow, type VerbChanges } from '../../services/draft-changes';

export interface NetworkRulesDraftChangesProps {
  /** Every verb's gains and losses, as the fleet answers them; undefined while not known. */
  changes: readonly VerbChanges[] | undefined;
  /** Why the fleet could not answer them. */
  error?: string;
  onRetry?: () => void;
}

/**
 * What the draft would change once applied (decision 0035): per verb, the
 * pairs of ships it gains and the ones it loses, each with the rule that
 * allows it, among the ships the session reads. Gains and losses each say so
 * in words, never by colour alone. Props only.
 */
export function NetworkRulesDraftChanges({ changes, error, onRetry }: NetworkRulesDraftChangesProps) {
  let content;
  if (error !== undefined) {
    content = <InlineError title="Couldn’t read what the draft changes" description={error} onRetry={onRetry} />;
  } else if (changes === undefined) {
    content = <LoadingSkeleton variant="detail" rows={3} label="Loading what the draft changes" />;
  } else if (isUnchanged(changes)) {
    content = (
      <p className="text-meta text-muted-foreground" data-testid="network-draft-changes-none">
        The draft changes no reach.
      </p>
    );
  } else {
    content = changes
      .filter(({ gained, lost }) => gained.length + lost.length > 0)
      .map(({ verb, gained, lost }) => (
        <div key={verb} className="flex flex-col gap-2" data-testid="network-draft-changes-verb">
          <h3 className="text-meta font-semibold">{VERB_WORDS[verb]}</h3>
          <ChangeList title="Gains" rows={gained} testId="network-draft-gained" />
          <ChangeList title="Loses" rows={lost} testId="network-draft-lost" />
        </div>
      ));
  }

  return (
    <section aria-labelledby="network-draft-changes" data-testid="network-draft-changes" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <h2 id="network-draft-changes" className="text-body font-semibold">
        What the draft changes
      </h2>
      {content}
    </section>
  );
}

function ChangeList({ title, rows, testId }: { title: string; rows: readonly ReachChangeRow[]; testId: string }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-meta text-muted-foreground">
        {title} {rows.length} {rows.length === 1 ? 'pair' : 'pairs'}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} data-testid={testId} className="flex flex-wrap items-center gap-x-2 text-body">
            <span>{row.from}</span>
            <ArrowRight aria-label="to" className="size-4 text-muted-foreground" />
            <span>{row.to}</span>
            <span className="text-meta text-muted-foreground">{row.rule}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
