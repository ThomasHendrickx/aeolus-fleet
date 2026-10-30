import { KeyRound } from 'lucide-react';
import Link from 'next/link';

interface KeyNotReachableNoticeProps {
  title: string;
  description: string;
}

/**
 * The fleet overview's notice while the company key is not reachable
 * (decision 0068, screen 2): in the attention tone, as the limit notice, with
 * View sealing to the sealing page.
 */
export function KeyNotReachableNotice({ title, description }: KeyNotReachableNoticeProps) {
  return (
    <div role="status" data-testid="overview-key-not-reachable" className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-tone-attention-fg">
      <KeyRound aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">{title}</p>
        <p className="text-meta text-foreground">{description}</p>
        <Link href="/sealing" className="self-start text-meta font-medium text-tone-attention-fg underline underline-offset-2" data-testid="overview-key-not-reachable-view">
          View sealing
        </Link>
      </div>
    </div>
  );
}
