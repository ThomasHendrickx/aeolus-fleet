import type { ReachRefusal } from '@aeolus-fleet/common';
import type { ReactNode } from 'react';

import { chipsOf, type LabelContext } from '../../../../lib/labels';
import { refusalCauseOf, refusalSentenceOf, refusedActorName } from '../../services/reach-refusals';
import { fullDateTime, relativeTime } from '../../../../lib/relative-time';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LabelChip } from '../../../../components/molecules/label-chip';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';

export interface ReachRefusalLogProps {
  /** Newest first, as the fleet lists them; undefined while not known. */
  refusals: readonly ReachRefusal[] | undefined;
  /** Why the fleet could not list them. */
  error?: string;
  onRetry?: () => void;
  /** What ends the log while older refusals follow: Load more. */
  more?: ReactNode;
  /** Whose each label is, for its chip's mark. */
  context: LabelContext;
  /** The time each refusal's "ago" is measured from. */
  now: Date;
}

/** A ship or an account of a refusal: its name and the labels it carried then. */
interface RefusedParty {
  name: string;
  labels: Extract<ReachRefusal['recipient'], { kind: 'ship' }>['ship']['labels'];
}

/**
 * The reach refusals log on Network (design point 7 on #260; decision 0034):
 * every send the rules refused, newest first. Each says who tried to message
 * whom, both ships' labels as they were then, and the network settings
 * version that refused it. Argo's only: the page shows it to argo. One column of
 * cards, so it reads the same on a phone.
 */
export function ReachRefusalLog({ refusals, error, onRetry, more, context, now }: ReachRefusalLogProps) {
  let content;
  if (error !== undefined) {
    content = <InlineError title="Couldn’t read the refusals" description={error} onRetry={onRetry} />;
  } else if (refusals === undefined) {
    content = <LoadingSkeleton variant="list" rows={3} label="Loading the refusals" />;
  } else if (refusals.length === 0 && !more) {
    content = <EmptyState variant="section" title="No send has been refused." />;
  } else {
    content = (
      <ol className="flex flex-col gap-2" data-testid="network-refusals-list">
        {refusals.map((refusal) => (
          <Refusal key={refusal.id} refusal={refusal} context={context} now={now} />
        ))}
      </ol>
    );
  }

  return (
    <section aria-labelledby="network-refusals" data-testid="network-refusals" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <h2 id="network-refusals" className="text-body font-semibold">
        Refusals
      </h2>
      <p className="text-meta text-muted-foreground">
        The sends the rules refused, newest first, with both ships’ labels as they were then. The sender was told only that its send was refused.
      </p>
      {content}
      {more}
    </section>
  );
}

function Refusal({ refusal, context, now }: { refusal: ReachRefusal; context: LabelContext; now: Date }) {
  const at = new Date(refusal.at);
  const { recipient } = refusal;
  const recipientShips = recipient.kind === 'ship' ? [recipient.ship] : recipient.ships;
  return (
    <li data-testid="network-refusal" className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-body font-medium">{refusalSentenceOf(refusal)}</p>
        <time dateTime={refusal.at} title={fullDateTime(at)} className="text-meta text-muted-foreground tabular-nums">
          {relativeTime(at, now)}
        </time>
      </div>
      <dl className="flex flex-col gap-1.5">
        <ShipLabelsThen side="From" ship={{ name: refusedActorName(refusal.sender), labels: refusal.sender.kind === 'installation' ? [] : refusal.sender.labels }} context={context} />
        {recipientShips.map((ship) => (
          <ShipLabelsThen key={ship.id} side="To" ship={ship} context={context} />
        ))}
      </dl>
      <p className="text-meta text-muted-foreground">{refusalCauseOf(refusal)}</p>
    </li>
  );
}

/** One party of a refusal and the labels it carried then; "No labels" without any. */
function ShipLabelsThen({ side, ship, context }: { side: 'From' | 'To'; ship: RefusedParty; context: LabelContext }) {
  const chips = chipsOf(ship, context);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <dt className="text-meta text-muted-foreground">
        {side} <span className="font-medium text-foreground">{ship.name}</span>
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1">
        {chips.length === 0 ? (
          <span className="text-meta text-muted-foreground">No labels</span>
        ) : (
          chips.map((chip) => <LabelChip key={chip.valueId} chip={chip} testId="network-refusal-label" />)
        )}
      </dd>
    </div>
  );
}
