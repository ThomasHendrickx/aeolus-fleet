import type { NoticeLink, noticeSchema } from '@aeolus-fleet/common';
import { Info, X } from 'lucide-react';
import type { z } from 'zod';

import { Button } from '../../../components/atoms/button';

/** A notice as `console.notices` answers it. */
export type Notice = z.output<typeof noticeSchema>;

interface NoticeBannerProps {
  notice: Notice;
  /** Dismisses the notice for this session; shown only on a dismissible notice. */
  onDismiss?: () => void;
  /** Follows a link that signs out: ends the session first, then goes on. */
  onSignOut?: (link: NoticeLink) => void;
}

/**
 * A notice the installation set (decision 0023), above every console page:
 * its text, its links, and Dismiss when the installation made it
 * dismissible. A calm panel (conventions: calm notice uses `--muted`),
 * since nothing went wrong.
 */
export function NoticeBanner({ notice, onDismiss, onSignOut }: NoticeBannerProps) {
  return (
    <div role="status" data-testid="notice" data-notice-id={notice.id} className="flex items-start gap-2 border-b border-border bg-muted px-8 py-2.5 max-sm:px-4">
      <Info aria-hidden className="mt-0.5 size-(--size-icon) shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 grow flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-meta text-foreground">{notice.text}</p>
        {notice.links.map((link) =>
          link.isSignOut === true ? (
            <button
              key={link.label}
              type="button"
              data-testid="notice-link"
              className="text-meta font-medium text-foreground underline underline-offset-2"
              onClick={() => onSignOut?.(link)}
            >
              {link.label}
            </button>
          ) : (
            <a key={link.label} href={link.url} data-testid="notice-link" className="text-meta font-medium text-foreground underline underline-offset-2">
              {link.label}
            </a>
          ),
        )}
      </div>
      {notice.isDismissible && onDismiss ? (
        <Button variant="ghost" size="xs" isIconOnly aria-label="Dismiss" data-testid="notice-dismiss" onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
