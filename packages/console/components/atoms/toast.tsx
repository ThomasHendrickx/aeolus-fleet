'use client';

import { CircleAlert, CircleCheck, Info, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast as sonner, Toaster as SonnerToaster } from 'sonner';

import { classNames } from '../../lib/class-names';
import { Button } from './button';

/** Success and info close on their own after this long; errors stay until dismissed. */
const SUCCESS_DURATION_MS = 5_000;

type ToastTone = 'success' | 'info' | 'error';

interface ToastContent {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** One follow-up: View, Try again, Copy id. */
  action?: { label: string; icon?: ReactNode; onClick: () => void };
}

const TONE_ICONS: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden className="text-tone-ok-fg" />,
  info: <Info aria-hidden className="text-muted-foreground" />,
  error: <CircleAlert aria-hidden className="text-tone-attention-fg" />,
};

/**
 * One toast as the design draws it (docs/design/png/Toast.png): tone icon,
 * title, one sentence, one follow-up. An error says so to assistive
 * technology at once and carries its own close button.
 */
function ToastCard({
  title,
  description,
  tone = 'success',
  action,
  onDismiss,
}: ToastContent & { onDismiss?: () => void }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex w-full gap-3 rounded-lg border border-border bg-popover py-3.5 pr-3.5 pl-4 text-popover-foreground shadow-lg sm:w-(--size-toast) [&>svg]:mt-0.5 [&>svg]:size-(--size-icon) [&>svg]:shrink-0"
    >
      {TONE_ICONS[tone]}
      <div className="flex min-w-0 grow flex-col gap-1">
        <span className="text-body font-medium">{title}</span>
        {description ? <span className="text-meta text-muted-foreground">{description}</span> : null}
        {action ? (
          <div className="mt-1 flex gap-1.5">
            <Button variant="secondary" size="xs" icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
      {tone === 'error' && onDismiss ? (
        <Button variant="ghost" size="xs" isIconOnly aria-label="Dismiss" className="-mt-1 -mr-1" onClick={onDismiss}>
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

/** Shows a toast: confirms a finished action or offers one follow-up. Never validation, never the only record. */
function showToast(content: ToastContent): void {
  const isError = content.tone === 'error';
  sonner.custom(
    (id) => (
      <ToastCard
        {...content}
        onDismiss={() => {
          sonner.dismiss(id);
        }}
      />
    ),
    { duration: isError ? Number.POSITIVE_INFINITY : SUCCESS_DURATION_MS },
  );
}

/** Desktop bottom right, 24 px in; phone 12 px from the edges, above the TabBar. */
function Toaster({ className }: { className?: string }) {
  return (
    <SonnerToaster
      position="bottom-right"
      offset="calc(var(--spacing) * 6)"
      mobileOffset={{
        left: 'calc(var(--spacing) * 3)',
        right: 'calc(var(--spacing) * 3)',
        bottom: 'calc(var(--size-tabbar) + var(--spacing) * 3)',
      }}
      toastOptions={{ unstyled: true }}
      className={classNames('toaster', className)}
    />
  );
}

export { showToast, ToastCard, Toaster };
