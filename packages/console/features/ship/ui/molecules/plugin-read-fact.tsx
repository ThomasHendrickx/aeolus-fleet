import type { ShipDetail } from '@aeolus-fleet/common';
import { TriangleAlert } from 'lucide-react';

import { classNames } from '@aeolus-fleet/ui';
import { fullDateTime, shortDateTime } from '../../../../lib/relative-time';

type PluginReads = NonNullable<ShipDetail['pluginReads']>;
type FailedRead = NonNullable<PluginReads['lastFailed']>;

const failureReasons: Record<FailedRead['reason'], string> = {
  'no-answer': 'No answer',
  timeout: 'Timeout',
  'unusable-answer': 'An answer the console cannot use',
};

function ReadRow({ label, read, reason }: {
  label: string;
  read: PluginReads['lastGood'];
  reason?: FailedRead['reason'];
}) {
  const at = read === null ? null : new Date(read.at);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-1 bg-card px-3.5 py-3 max-sm:grid-cols-[7rem_minmax(0,1fr)] max-sm:gap-1.5 max-sm:py-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-meta">
        {read === null || at === null ? (
          <span className="text-muted-foreground">No good read yet</span>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <code className="min-w-0 font-mono text-id wrap-anywhere">{read.read}</code>
            <time dateTime={read.at} title={fullDateTime(at)} className="tabular-nums">{shortDateTime(at)}</time>
          </div>
        )}
        {reason === undefined ? null : <p className="mt-0.5 text-muted-foreground">{failureReasons[reason]}</p>}
      </dd>
    </div>
  );
}

/** The plugin's recorded reads. The attention heading follows the current failure run. */
export function PluginReadFact({ reads }: { reads: ShipDetail['pluginReads'] }) {
  if (!reads || (!reads.failingSince && !reads.lastFailed && !reads.lastGood)) {
    return null;
  }

  const { failingSince, lastFailed, lastGood } = reads;
  return (
    <section
      aria-label={failingSince ? 'Plugin read failed' : 'Plugin reads'}
      data-testid="ship-plugin-reads"
      className={classNames('overflow-hidden rounded-lg border', failingSince ? 'border-tone-attention-border' : 'border-border')}
    >
      {failingSince && (
        <h2 className="flex items-center gap-1.5 border-b border-tone-attention-border bg-tone-attention-bg px-3.5 py-2.5 text-meta font-semibold text-tone-attention-fg">
          <TriangleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
          Plugin read failed
        </h2>
      )}
      <dl className="grid auto-cols-fr grid-flow-col gap-px bg-border max-sm:grid-flow-row">
        {failingSince && <ReadRow label="Failing since" read={failingSince} />}
        {lastFailed && <ReadRow label="Last failed read" read={lastFailed} reason={lastFailed.reason} />}
        {(lastGood !== null || failingSince !== null) && <ReadRow label="Last good read" read={lastGood} />}
      </dl>
    </section>
  );
}
