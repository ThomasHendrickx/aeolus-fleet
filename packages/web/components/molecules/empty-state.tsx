import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';

interface EmptyStateProps {
  /** Says what is empty: "No ships besides argo yet". */
  title: string;
  /** One sentence on what fills it. */
  description?: ReactNode;
  /** A Lucide icon for the page variant. */
  icon?: ReactNode;
  /** One action, only when the operator can fix it from here; for no results, the way back. */
  action?: ReactNode;
  variant?: 'page' | 'section' | 'no-results';
  className?: string;
}

/**
 * Says what is empty and what happens next (docs/design/png/EmptyState.png),
 * in two short sentences at most. Page: a dashed frame with an icon tile and
 * one action. Section: one quiet line. No results: the line plus the way back
 * ("Clear search").
 */
export function EmptyState({ title, description, icon, action, variant = 'page', className }: EmptyStateProps) {
  if (variant === 'section') {
    return (
      <p
        data-slot="empty-state"
        data-variant={variant}
        className={classNames(
          'rounded-lg border border-border px-4 py-3 text-center text-meta text-muted-foreground',
          className,
        )}
      >
        {title}
        {description ? <> {description}</> : null}
      </p>
    );
  }
  if (variant === 'no-results') {
    return (
      <div
        data-slot="empty-state"
        data-variant={variant}
        className={classNames(
          'flex flex-col items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-6 text-center',
          className,
        )}
      >
        <p className="text-meta text-muted-foreground">{title}</p>
        {action}
      </div>
    );
  }
  return (
    <div
      data-slot="empty-state"
      data-variant={variant}
      className={classNames(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground [&_svg]:size-(--size-icon-xl)"
        >
          {icon}
        </span>
      ) : null}
      <h2 className="text-heading font-semibold text-foreground max-sm:text-heading-touch">{title}</h2>
      {description ? (
        <p className="max-w-96 text-meta text-muted-foreground max-sm:text-body-touch">{description}</p>
      ) : null}
      {action ? <div className="mt-1 max-sm:w-full max-sm:[&>*]:w-full">{action}</div> : null}
    </div>
  );
}
