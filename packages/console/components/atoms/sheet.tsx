'use client';

import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';
import { Button } from './button';

/**
 * shadcn Sheet on Base UI Dialog (docs/design/png/Sheet.png). Right: the
 * desktop side sheet, 560 px, header with title, context and close, scrolling
 * body, footer. Bottom: the phone sheet for menus, filters and confirms, with a
 * handle, --radius-2xl top corners and full-width 44 px actions, Cancel last.
 * Under reduced motion it fades instead of sliding.
 */
const sheetPopup = cva(
  'fixed z-50 flex flex-col bg-popover text-body text-popover-foreground shadow-lg outline-none duration-(--duration-slow) ease-(--ease-standard) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full border-l border-border sm:max-w-(--size-sheet) motion-safe:data-open:slide-in-from-right motion-safe:data-closed:slide-out-to-right',
        bottom:
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t border-border px-4 pt-2 pb-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] motion-safe:data-open:slide-in-from-bottom motion-safe:data-closed:slide-out-to-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: SheetPrimitive.Popup.Props & VariantProps<typeof sheetPopup>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-overlay duration-(--duration-slow) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={classNames(sheetPopup({ side }), className)}
        {...props}
      >
        {side === 'bottom' ? (
          <div aria-hidden className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-border" />
        ) : (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button variant="ghost" size="sm" isIconOnly className="absolute top-4 right-4" aria-label="Close" />
            }
          >
            <XIcon />
          </SheetPrimitive.Close>
        )}
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={classNames(
        'flex flex-col gap-0.5 in-data-[side=right]:border-b in-data-[side=right]:px-6 in-data-[side=right]:py-5 in-data-[side=right]:pr-14',
        className,
      )}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={classNames('min-h-0 flex-1 overflow-y-auto in-data-[side=right]:p-6', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={classNames(
        'flex flex-col-reverse gap-2 pt-3 in-data-[side=right]:flex-row in-data-[side=right]:justify-end in-data-[side=right]:border-t in-data-[side=right]:px-6 in-data-[side=right]:py-4',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={classNames(
        'text-heading font-semibold text-foreground in-data-[side=bottom]:py-2 in-data-[side=bottom]:text-section',
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={classNames('text-meta text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
