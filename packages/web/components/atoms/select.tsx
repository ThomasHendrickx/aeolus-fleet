'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronDown } from 'lucide-react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Select on Base UI, themed to docs/design/png/Select.png: closed lists
 * that need no search, such as the overview filters. Small in the toolbar,
 * touch height in a phone filter Sheet. The trigger may lead with a muted
 * label ("Status") before the value.
 */
const Select = SelectPrimitive.Root;

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

const triggerVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-between gap-1.5 rounded-md border border-input bg-card whitespace-nowrap text-foreground shadow-sm transition-[border-color,box-shadow] duration-(--duration-fast) outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/22 data-disabled:pointer-events-none data-disabled:opacity-45 data-popup-open:border-ring [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: 'h-(--size-control-sm) px-2.5 text-meta [&_svg]:size-(--size-icon-sm)',
        touch: 'h-(--size-control-touch) w-full rounded-lg px-3 text-body-touch [&_svg]:size-(--size-icon)',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

function SelectTrigger({
  className,
  size,
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof triggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={classNames(triggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex text-muted-foreground">
        <ChevronDown aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="isolate z-50 outline-none" sideOffset={4} alignItemWithTrigger={false}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={classNames(
            'max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg duration-(--duration-fast) outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={classNames(
        'relative flex h-8.5 cursor-default items-center gap-2.5 rounded-sm pr-8 pl-2.5 text-body text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
        <Check aria-hidden className="size-(--size-icon)" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
