'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';
import { dialogSurface } from './dialog-surface';

/**
 * shadcn Dialog on Base UI, for a blocking short form (docs/design/png/Dialog.png):
 * sm (512 px) for confirms, md (560 px) for forms. Escape and Cancel close it;
 * focus moves to the first field and returns to the trigger. While busy, the
 * caller keeps it open and disables everything but the loading action.
 */
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  className,
  size,
  children,
  ...props
}: DialogPrimitive.Popup.Props & VariantProps<typeof dialogSurface.popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={dialogSurface.overlay} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={classNames(dialogSurface.popup({ size }), className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={classNames(dialogSurface.header, className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={classNames(dialogSurface.footer, className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title data-slot="dialog-title" className={classNames(dialogSurface.title, className)} {...props} />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={classNames(dialogSurface.description, className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
