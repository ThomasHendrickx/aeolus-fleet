'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Popover on Base UI: a card placed against an element, its trigger or
 * any anchor, with an arrow pointing at it. Props only.
 */
function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverContent({
  className,
  children,
  anchor,
  side = 'bottom',
  sideOffset = 10,
  align = 'center',
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'align' | 'anchor' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner anchor={anchor} align={align} side={side} sideOffset={sideOffset} className="isolate z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={classNames(
            'origin-(--transform-origin) rounded-xl border border-border bg-popover text-popover-foreground shadow-lg duration-(--duration-fast) outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          <PopoverPrimitive.Arrow className="data-[side=bottom]:-top-1.5 data-[side=left]:-right-1.5 data-[side=right]:-left-1.5 data-[side=top]:-bottom-1.5">
            <span aria-hidden className="block size-3 rotate-45 border-t border-l border-border bg-popover in-data-[side=left]:rotate-135 in-data-[side=right]:-rotate-45 in-data-[side=top]:-rotate-135" />
          </PopoverPrimitive.Arrow>
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

export { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger };
