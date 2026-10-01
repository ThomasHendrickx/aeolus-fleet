import { CircleAlert, CloudOff, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';
import { Button } from '../atoms/button';

interface InlineErrorProps {
  /** Page: "Couldn’t <verb> <thing>". Section: what failed. Field: the broken rule. */
  title: string;
  /** Whether anything changed or was lost, and what to do. */
  description?: ReactNode;
  /** The technical reason, in mono (page only). */
  detail?: string;
  /** Page only: Try again. */
  onRetry?: () => void;
  /** Page only: the automatic retry, such as "Retrying in 12 s". */
  retryNote?: string;
  variant?: 'field' | 'section' | 'page';
  /** The field variant's id, for the field's aria-describedby. */
  id?: string;
  className?: string;
}

/**
 * Errors say what failed, whether anything changed and what to do
 * (docs/design/png/InlineError.png). Field: under the field, in
 * --destructive-text. Section: an attention panel where the action was taken.
 * Page: replaces the content and keeps the chrome, with the technical reason in
 * mono and Try again.
 */
export function InlineError({
  title,
  description,
  detail,
  onRetry,
  retryNote,
  variant = 'section',
  id,
  className,
}: InlineErrorProps) {
  if (variant === 'field') {
    return (
      <p
        id={id}
        data-slot="inline-error"
        data-variant={variant}
        className={classNames(
          'flex items-center gap-1.5 text-meta text-destructive-text [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0',
          className,
        )}
      >
        <CircleAlert aria-hidden />
        {title}
      </p>
    );
  }
  if (variant === 'section') {
    return (
      <div
        role="alert"
        data-slot="inline-error"
        data-variant={variant}
        className={classNames(
          'flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-tone-attention-fg',
          className,
        )}
      >
        <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium">{title}</p>
          {description ? <p className="text-meta text-foreground">{description}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-slot="inline-error"
      data-variant={variant}
      className={classNames(
        'flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg border border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg [&_svg]:size-(--size-icon-xl)"
      >
        <CloudOff />
      </span>
      <h2 className="text-heading font-semibold text-foreground max-sm:text-heading-touch">{title}</h2>
      {description ? (
        <p className="max-w-96 text-meta text-muted-foreground max-sm:text-body-touch">{description}</p>
      ) : null}
      {detail ? (
        <code className="rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-id text-muted-foreground">
          {detail}
        </code>
      ) : null}
      {onRetry ? (
        <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-col">
          <Button size="sm" icon={<RotateCw aria-hidden />} onClick={onRetry} className="max-sm:w-full">
            Try again
          </Button>
          {retryNote ? <span className="text-meta text-muted-foreground">{retryNote}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
