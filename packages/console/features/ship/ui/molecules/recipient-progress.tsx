/** The recipient's declared progress on this message, separate from its delivery state (monitoring W2). */
import type { MessageDelivery } from '@aeolus-fleet/common';
import { Activity, CirclePause, OctagonPause } from 'lucide-react';

import { REPORT_STATE_WORDS, reportChangedWhen } from '../../../../lib/report';
import { reportStepText } from '../../../../lib/report-task';
import { fullDateTime } from '../../../../lib/relative-time';

const ICONS = { working: Activity, blocked: OctagonPause, idle: CirclePause };
const TONES = { working: 'text-tone-active-fg', blocked: 'text-tone-waiting-fg', idle: 'text-tone-ended-fg' };

export function RecipientProgress({ progress, now }: { progress: MessageDelivery['progress']; now: Date }) {
  if (progress === null) {
    return null;
  }
  const Icon = ICONS[progress.state];
  const changedAt = new Date(progress.reportChangedAt);
  return (
    <span data-testid="message-recipient-progress" className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta">
      <span className={`inline-flex items-center gap-1.5 font-medium ${TONES[progress.state]}`}>
        <Icon aria-hidden className="size-(--size-icon-sm)" />
        {REPORT_STATE_WORDS[progress.state]}
      </span>
      {progress.step === null ? null : <span className="text-muted-foreground tabular-nums">{reportStepText(progress.step, 'full')}</span>}
      {progress.note === null ? null : <span className="min-w-0 truncate text-foreground">{progress.note}</span>}
      <time dateTime={progress.reportChangedAt} title={fullDateTime(changedAt)} className="text-muted-foreground tabular-nums">{reportChangedWhen(changedAt, now)}</time>
    </span>
  );
}
