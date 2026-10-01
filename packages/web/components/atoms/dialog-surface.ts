import { cva } from 'class-variance-authority';

/**
 * What Dialog and AlertDialog share (docs/design/png/Dialog.png): the --overlay
 * scrim, a centred popup 512 or 560 px wide with 24 px padding and
 * --radius-xl, and the header and footer layout. Under reduced motion nothing
 * zooms; it only fades.
 */
export const dialogSurface = {
  overlay:
    'fixed inset-0 isolate z-50 bg-overlay duration-(--duration-base) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
  popup: cva(
    'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-var(--spacing)*8)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-6 text-body text-popover-foreground shadow-lg duration-(--duration-base) outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100',
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
};
