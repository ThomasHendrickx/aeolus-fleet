import { Gauge } from 'lucide-react';

interface LimitNoticeProps {
  title: string;
  description: string;
  /** Where the hosted account lists the fleet's limits; without it, the notice has no link. */
  accountUrl?: string;
  testId?: string;
}

/**
 * The fleet is at one of its limits (canvas, Console touches 12.1 to 12.3):
 * what happened and when it changes, in the attention tone, with View limits
 * on the hosted account when the console knows where that is.
 */
export function LimitNotice({ title, description, accountUrl, testId }: LimitNoticeProps) {
  return (
    <div role="status" data-testid={testId} className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-tone-attention-fg">
      <Gauge aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">{title}</p>
        <p className="text-meta text-foreground">{description}</p>
        {accountUrl === undefined ? null : (
          <a href={accountUrl} className="self-start text-meta font-medium text-tone-attention-fg underline underline-offset-2" data-testid={testId === undefined ? undefined : `${testId}-view`}>
            View limits
          </a>
        )}
      </div>
    </div>
  );
}
