import type { ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, dialogSurface } from '@aeolus-fleet/ui';

/** A focus-trapped form: desktop dialog, phone modal TopBar and pinned primary action. */
export function McpFormShell({
  title,
  description,
  isPending,
  isDisabled,
  action,
  onClose,
  onSubmit,
  children,
  size = 'md',
}: {
  title: string;
  description: string;
  isPending: boolean;
  isDisabled?: boolean;
  action: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !isPending) onClose();
      }}
    >
      <DialogContent
        size={size}
        data-testid="mcp-form"
        className={`${dialogSurface.phoneFullScreen} max-sm:max-h-none max-sm:bg-background max-sm:flex max-sm:flex-col max-sm:gap-0 max-sm:p-0`}
      >
        <form
          className="contents"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!isPending && !isDisabled) onSubmit();
          }}
        >
          <div className="max-sm:grid max-sm:h-(--size-header) max-sm:shrink-0 max-sm:grid-cols-[1fr_auto_1fr] max-sm:items-center max-sm:border-b max-sm:border-border max-sm:px-2">
            <Button
              variant="ghost"
              size="touch"
              disabled={isPending}
              onClick={onClose}
              data-testid="mcp-phone-cancel"
              className="justify-self-start text-body-touch sm:hidden"
            >
              Cancel
            </Button>
            <DialogTitle className="max-sm:truncate max-sm:text-body-touch">{title}</DialogTitle>
          </div>
          <div className="flex flex-col gap-4 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto max-sm:px-4 max-sm:py-4">
            <DialogDescription className="sm:-mt-2 max-sm:text-body-touch">{description}</DialogDescription>
            {children}
          </div>
          <footer className="flex justify-end gap-2 pt-1 max-sm:shrink-0 max-sm:border-t max-sm:border-border max-sm:bg-background max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))]">
            <Button disabled={isPending} onClick={onClose} data-testid="mcp-cancel" className="max-sm:hidden">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isPending}
              disabled={isDisabled}
              data-testid="mcp-submit"
              className="max-sm:h-(--size-control-touch) max-sm:w-full max-sm:text-body-touch"
            >
              {isPending ? 'Saving' : action}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
