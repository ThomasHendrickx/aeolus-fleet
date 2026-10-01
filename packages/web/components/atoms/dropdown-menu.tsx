'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Check } from 'lucide-react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn DropdownMenu on Base UI Menu (docs/design/png/DropdownMenu.png).
 * Desktop only; on phone the same items open in a bottom Sheet. Items that
 * open a dialog end with an ellipsis. The destructive item is last, after a
 * separator, in --destructive-text.
 */
function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = 'end',
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-50 outline-none" align={align} side={side} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={classNames(
            'max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg duration-(--duration-fast) outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: MenuPrimitive.Item.Props & { variant?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={classNames(
        "relative flex h-8.5 items-center gap-2.5 rounded-sm px-2.5 text-body text-foreground outline-none select-none data-highlighted:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-45 data-[variant=destructive]:text-destructive-text [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--size-icon) [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-destructive-text",
        className,
      )}
      {...props}
    />
  );
}

/** A small heading over a group of items, such as Theme. */
function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={classNames('px-2.5 pt-1.5 pb-1 text-caption text-muted-foreground', className)}
      {...props}
    />
  );
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

/** One choice of a radio group: the check sits at the end of the row while it is chosen. */
function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={classNames(
        "relative flex h-8.5 items-center gap-2.5 rounded-sm px-2.5 text-body text-foreground outline-none select-none data-highlighted:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--size-icon) [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <MenuPrimitive.RadioItemIndicator className="ml-auto flex">
        <Check aria-hidden className="text-foreground" />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={classNames('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
