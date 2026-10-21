import { cva } from 'class-variance-authority';

/**
 * What Dialog and AlertDialog share (docs/design/png/Dialog.png): the --overlay
 * scrim, a centred popup 512 or 560 px wide with 24 px padding and
 * --radius-xl, and the header and footer layout. A popup taller than the
 * window scrolls inside it, so its buttons stay in reach. Under reduced motion
 * nothing zooms; it only fades.
 */
export const dialogSurface = {
  overlay:
    'fixed inset-0 isolate z-50 bg-overlay duration-(--duration-base) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
  popup: cva(
    'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-var(--spacing)*8)] w-full max-w-[calc(100%-var(--spacing)*8)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-border bg-popover p-6 text-body text-popover-foreground shadow-lg duration-(--duration-base) outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100',
    {
      variants: {
        size: {
          sm: 'sm:max-w-(--size-dialog-sm)',
          md: 'sm:max-w-(--size-dialog-md)',
        },
      },
      defaultVariants: { size: 'sm' },
    },
  ),
  header: 'flex flex-col gap-2',
  // Desktop: right-aligned, Cancel left of the action. Phone: stacked full
  // width, action on top, Cancel last (docs/design/conventions.md, "Buttons").
  footer: 'flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end',
  title: 'text-heading font-semibold text-foreground',
  description: 'text-body text-muted-foreground',
  // On phone a confirm rises as a bottom sheet (docs/design/png/Sheet.png):
  // pinned to the bottom, full width, rounded top, clear of the home bar.
  phoneSheet:
    'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:px-4 max-sm:pb-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] max-sm:[&_[data-slot=button]]:h-(--size-control-touch) max-sm:[&_[data-slot=button]]:w-full',
  // On phone a dialog that shows a form or a prompt fills the screen.
  phoneFullScreen:
    'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0',
};
