'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

import { classNames } from '../../lib/class-names';

/** Hover waits this long before a tooltip opens; keyboard focus opens it at once. */
const HOVER_DELAY_MS = 500;

/**
 * shadcn Tooltip on Base UI (docs/design/png/Tooltip.png). Supplementary only:
 * the same text is also the accessible name or visible elsewhere. None on phone.
 */
function TooltipProvider({ delay = HOVER_DELAY_MS, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  ...props
}: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50 max-sm:hidden"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={classNames(
            'w-fit max-w-xs origin-(--transform-origin) rounded-sm bg-foreground px-2 py-1 text-caption font-medium text-background shadow-md duration-(--duration-fast) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
