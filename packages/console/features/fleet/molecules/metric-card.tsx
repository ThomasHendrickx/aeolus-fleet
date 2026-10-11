import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { classNames } from '../../../lib/class-names';

export type MetricTone = 'ok' | 'waiting' | 'attention';

const TONE: Record<MetricTone, string> = {
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
};

interface MetricCardProps {
  /** The label on desktop. */
  label: string;
  /** A shorter label on phone, where two cards share a row; the label when not set. */
  shortLabel?: string;
  value: number;
  /** One line under the value. */
  detail: string;
  /** Where the card goes: the list it counts. */
  href: string;
  icon: LucideIcon;
  tone: MetricTone;
  testId?: string;
}

/**
 * One count on the fleet overview (canvas, OverviewVaried): label and icon,
 * the number, a line of detail, and the whole card links to what it counts.
 * The icon's tone repeats the label, so status never rests on colour alone.
 */
export function MetricCard({ label, shortLabel, value, detail, href, icon: Icon, tone, testId }: MetricCardProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4.5 py-4 shadow-sm transition-colors duration-(--duration-fast) hover:bg-accent max-sm:gap-1.5 max-sm:rounded-xl max-sm:px-3.5 max-sm:py-3"
    >
      <span className="flex items-center justify-between gap-2 text-meta font-medium text-muted-foreground">
        <span className="max-sm:hidden">{label}</span>
        <span className="sm:hidden">{shortLabel ?? label}</span>
        <span className={classNames('flex size-6.5 shrink-0 items-center justify-center rounded-md border max-sm:size-5.5', TONE[tone])}>
          <Icon aria-hidden className="size-3.5" />
        </span>
      </span>
      <span className="text-[28px] leading-none font-semibold tracking-tight tabular-nums text-foreground max-sm:text-2xl">{value}</span>
      <span className="truncate text-meta text-muted-foreground">{detail}</span>
    </Link>
  );
}
